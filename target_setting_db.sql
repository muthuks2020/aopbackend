

BEGIN;



CREATE SCHEMA IF NOT EXISTS target_setting;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";



-- Role enum: 5-level sales hierarchy + specialists + admin
DO $$ BEGIN
  CREATE TYPE target_setting.user_role AS ENUM (
    'sales_rep', 'tbm', 'abm', 'zbm', 'sales_head',
    'at_iol_manager', 'at_iol_specialist',
    'eq_mgr_diagnostic', 'eq_mgr_surgical',
    'eq_spec_diagnostic', 'eq_spec_surgical',
    'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Commitment status: 4-state workflow (no reject cycle)
-- not_started â†’ draft â†’ submitted â†’ approved
DO $$ BEGIN
  CREATE TYPE target_setting.commitment_status AS ENUM (
    'not_started', 'draft', 'submitted', 'approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Assignment status: for yearly target allocation
DO $$ BEGIN
  CREATE TYPE target_setting.assignment_status AS ENUM (
    'not_set', 'draft', 'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Approval action types
DO $$ BEGIN
  CREATE TYPE target_setting.approval_action AS ENUM (
    'submitted', 'approved', 'corrected_and_approved', 'bulk_approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Authentication provider (for dual-auth: local + Azure SSO)
DO $$ BEGIN
  CREATE TYPE target_setting.auth_provider_type AS ENUM (
    'local', 'azure_ad', 'both'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE TABLE IF NOT EXISTS target_setting.fiscal_years (
    id                  SERIAL PRIMARY KEY,
    code                VARCHAR(20)  NOT NULL UNIQUE,          -- 'FY26_27'
    label               VARCHAR(20)  NOT NULL,                 -- '2026-27'
    start_date          DATE         NOT NULL,                 -- Apr 1
    end_date            DATE         NOT NULL,                 -- Mar 31
    is_active           BOOLEAN      NOT NULL DEFAULT FALSE,   -- Current active FY
    is_commitment_open  BOOLEAN      NOT NULL DEFAULT FALSE,   -- TRUE = targets can be entered
    commitment_deadline TIMESTAMPTZ,                           -- Last date to submit commitments
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE target_setting.fiscal_years IS 
'Indian fiscal year: April to March. Months: APRâ†’MAR. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
is_commitment_open controls whether target entry is allowed. commitment_deadline is the cutoff date.';

-- Seed: 3 fiscal years
INSERT INTO target_setting.fiscal_years (code, label, start_date, end_date, is_active, is_commitment_open)
VALUES
    ('FY24_25', '2024-25', '2024-04-01', '2025-03-31', FALSE, FALSE),
    ('FY25_26', '2025-26', '2025-04-01', '2026-03-31', FALSE, FALSE),
    ('FY26_27', '2026-27', '2026-04-01', '2027-03-31', TRUE,  TRUE )
ON CONFLICT (code) DO NOTHING;



CREATE TABLE IF NOT EXISTS target_setting.auth_users (
    id                  SERIAL       PRIMARY KEY,
    employee_code       VARCHAR(20)  NOT NULL UNIQUE,          -- Company ID e.g. 'EMP-001'
    username            VARCHAR(50)  NOT NULL UNIQUE,          -- Login username
    password_hash       VARCHAR(255),                          -- bcrypt hash (NULLABLE for SSO-only users)
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(150),
    phone               VARCHAR(20),                           -- Mobile number

    role                target_setting.user_role NOT NULL,
    designation         VARCHAR(100),                          -- Display label e.g. 'Senior Sales Representative'

    -- Denormalized geography hierarchy (from AOP master tables for fast queries)
    zone_code           INTEGER,
    zone_name           VARCHAR(100),
    area_code           INTEGER,
    area_name           VARCHAR(100),
    territory_code      INTEGER,
    territory_name      VARCHAR(150),

    -- Direct manager (by employee_code); enables "get my subordinates" query
    -- SRâ†’TBM, TBMâ†’ABM, ABMâ†’ZBM, ZBMâ†’Sales Head
    reports_to          VARCHAR(20),

    -- Azure AD SSO fields (future-ready)
    azure_oid           VARCHAR(100) UNIQUE,                   -- Azure AD Object ID (primary SSO link)
    azure_upn           VARCHAR(255),                          -- User Principal Name (email in Azure AD)
    auth_provider       target_setting.auth_provider_type NOT NULL DEFAULT 'local',

    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_au_role        ON target_setting.auth_users(role);
CREATE INDEX IF NOT EXISTS idx_au_zone        ON target_setting.auth_users(zone_code);
CREATE INDEX IF NOT EXISTS idx_au_area        ON target_setting.auth_users(area_code);
CREATE INDEX IF NOT EXISTS idx_au_territory   ON target_setting.auth_users(territory_code);
CREATE INDEX IF NOT EXISTS idx_au_reports_to  ON target_setting.auth_users(reports_to);
CREATE INDEX IF NOT EXISTS idx_au_active      ON target_setting.auth_users(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_au_azure_oid   ON target_setting.auth_users(azure_oid) WHERE azure_oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_au_email       ON target_setting.auth_users(email);

COMMENT ON TABLE target_setting.auth_users IS 
'All members of the sales organization. Hierarchy via reports_to (employee_code of manager).
Roles: sales_rep, tbm, abm, zbm, sales_head + specialist roles + admin.
Zone/area/territory denormalized from AOP master tables for fast filtering.
SSO-ready: azure_oid + azure_upn + auth_provider columns for Azure AD integration.';
COMMENT ON COLUMN target_setting.auth_users.reports_to IS 'Employee code of direct manager. SRâ†’TBM, TBMâ†’ABM, ABMâ†’ZBM, ZBMâ†’Sales Head. NULL for top-level.';
COMMENT ON COLUMN target_setting.auth_users.azure_oid IS 'Azure AD Object ID. Primary key for SSO user lookup. NULL for local-only accounts.';
COMMENT ON COLUMN target_setting.auth_users.auth_provider IS 'local = password login only, azure_ad = SSO only, both = either method works.';



-- bcrypt hash of 'demo123' (10 rounds)
-- In production, generate proper hashes. This is for dev/staging only.
INSERT INTO target_setting.auth_users 
    (employee_code, username, password_hash, full_name, email, phone, role, designation,
     zone_code, zone_name, area_code, area_name, territory_code, territory_name, reports_to)
VALUES
    -- â”€â”€ SALES HEAD (Top of hierarchy, reports_to = NULL) â”€â”€
    ('SH-001', 'saleshead', '$2b$10$YourBcryptHashHere000000000000000000000000000000', 
     'Dr. Srinivasan R', 'srinivasan@appasamy.com', '9840000001', 
     'sales_head', 'Vice President - Sales',
     NULL, NULL, NULL, NULL, NULL, 'All India', NULL),

    -- â”€â”€ ZBMs (report to Sales Head SH-001) â”€â”€
    ('ZBM-001', 'zbm_north', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Amit Singh', 'amit.singh@appasamy.com', '9840000010',
     'zbm', 'Zonal Business Manager',
     1, 'Northern Zone', NULL, NULL, NULL, 'North India', 'SH-001'),

    ('ZBM-002', 'zbm_south', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Meera Krishnan', 'meera.k@appasamy.com', '9840000011',
     'zbm', 'Zonal Business Manager',
     2, 'Southern Zone', NULL, NULL, NULL, 'South India', 'SH-001'),

    -- â”€â”€ ABMs (report to their ZBM) â”€â”€
    -- North Zone ABMs â†’ ZBM-001
    ('ABM-001', 'abm_delhi', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Priya Sharma', 'priya.s@appasamy.com', '9840000020',
     'abm', 'Area Business Manager',
     1, 'Northern Zone', 101, 'Delhi NCR', NULL, 'Delhi NCR Region', 'ZBM-001'),

    ('ABM-002', 'abm_punjab', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Kavitha Reddy', 'kavitha.r@appasamy.com', '9840000021',
     'abm', 'Area Business Manager',
     1, 'Northern Zone', 102, 'Punjab & Haryana', NULL, 'Punjab Haryana Region', 'ZBM-001'),

    -- South Zone ABMs â†’ ZBM-002
    ('ABM-003', 'abm_chennai', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Ramesh Iyer', 'ramesh.i@appasamy.com', '9840000022',
     'abm', 'Area Business Manager',
     2, 'Southern Zone', 201, 'Tamil Nadu', NULL, 'Tamil Nadu Region', 'ZBM-002'),

    ('ABM-004', 'abm_karnataka', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Deepa Nair', 'deepa.n@appasamy.com', '9840000023',
     'abm', 'Area Business Manager',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', NULL, 'Karnataka Kerala Region', 'ZBM-002'),

    -- â”€â”€ TBMs (report to their ABM) â”€â”€
    -- Delhi NCR TBMs â†’ ABM-001
    ('TBM-001', 'tbm_central_delhi', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Rajesh Kumar', 'rajesh.k@appasamy.com', '9840000030',
     'tbm', 'Territory Business Manager',
     1, 'Northern Zone', 101, 'Delhi NCR', 1001, 'Central Delhi', 'ABM-001'),

    ('TBM-002', 'tbm_south_delhi', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Sunita Verma', 'sunita.v@appasamy.com', '9840000031',
     'tbm', 'Territory Business Manager',
     1, 'Northern Zone', 101, 'Delhi NCR', 1002, 'South Delhi', 'ABM-001'),

    -- Punjab TBMs â†’ ABM-002
    ('TBM-003', 'tbm_chandigarh', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Gurpreet Singh', 'gurpreet.s@appasamy.com', '9840000032',
     'tbm', 'Territory Business Manager',
     1, 'Northern Zone', 102, 'Punjab & Haryana', 1003, 'Chandigarh', 'ABM-002'),

    ('TBM-004', 'tbm_ludhiana', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Mandeep Kaur', 'mandeep.k@appasamy.com', '9840000033',
     'tbm', 'Territory Business Manager',
     1, 'Northern Zone', 102, 'Punjab & Haryana', 1004, 'Ludhiana', 'ABM-002'),

    -- Tamil Nadu TBMs â†’ ABM-003
    ('TBM-005', 'tbm_chennai_central', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Karthik Rajan', 'karthik.r@appasamy.com', '9840000034',
     'tbm', 'Territory Business Manager',
     2, 'Southern Zone', 201, 'Tamil Nadu', 2001, 'Chennai Central', 'ABM-003'),

    ('TBM-006', 'tbm_coimbatore', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Lakshmi Devi', 'lakshmi.d@appasamy.com', '9840000035',
     'tbm', 'Territory Business Manager',
     2, 'Southern Zone', 201, 'Tamil Nadu', 2002, 'Coimbatore', 'ABM-003'),

    -- Karnataka TBMs â†’ ABM-004
    ('TBM-007', 'tbm_bangalore', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Vinay Hegde', 'vinay.h@appasamy.com', '9840000036',
     'tbm', 'Territory Business Manager',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2003, 'Bangalore', 'ABM-004'),

    ('TBM-008', 'tbm_kochi', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Anjali Menon', 'anjali.m@appasamy.com', '9840000037',
     'tbm', 'Territory Business Manager',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2004, 'Kochi', 'ABM-004'),

    -- â”€â”€ SALES REPS (report to their TBM) â”€â”€
    -- Central Delhi SRs â†’ TBM-001
    ('SR-001', 'sr_vasanth', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Vasanthakumar C', 'vasanth.c@appasamy.com', '9840000040',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 101, 'Delhi NCR', 1001, 'Central Delhi', 'TBM-001'),

    ('SR-002', 'sr_rahul', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Rahul Mehta', 'rahul.m@appasamy.com', '9840000041',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 101, 'Delhi NCR', 1001, 'Central Delhi', 'TBM-001'),

    -- South Delhi SRs â†’ TBM-002
    ('SR-003', 'sr_neha', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Neha Gupta', 'neha.g@appasamy.com', '9840000042',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 101, 'Delhi NCR', 1002, 'South Delhi', 'TBM-002'),

    ('SR-004', 'sr_arun', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Arun Tiwari', 'arun.t@appasamy.com', '9840000043',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 101, 'Delhi NCR', 1002, 'South Delhi', 'TBM-002'),

    -- Chandigarh SRs â†’ TBM-003
    ('SR-005', 'sr_hardeep', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Hardeep Kaur', 'hardeep.k@appasamy.com', '9840000044',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 102, 'Punjab & Haryana', 1003, 'Chandigarh', 'TBM-003'),

    -- Ludhiana SRs â†’ TBM-004
    ('SR-006', 'sr_manpreet', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Manpreet Gill', 'manpreet.g@appasamy.com', '9840000045',
     'sales_rep', 'Sales Representative',
     1, 'Northern Zone', 102, 'Punjab & Haryana', 1004, 'Ludhiana', 'TBM-004'),

    -- Chennai Central SRs â†’ TBM-005
    ('SR-007', 'sr_senthil', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Senthil Murugan', 'senthil.m@appasamy.com', '9840000046',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 201, 'Tamil Nadu', 2001, 'Chennai Central', 'TBM-005'),

    ('SR-008', 'sr_divya', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Divya Subramani', 'divya.s@appasamy.com', '9840000047',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 201, 'Tamil Nadu', 2001, 'Chennai Central', 'TBM-005'),

    -- Coimbatore SRs â†’ TBM-006
    ('SR-009', 'sr_pradeep', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Pradeep Natarajan', 'pradeep.n@appasamy.com', '9840000048',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 201, 'Tamil Nadu', 2002, 'Coimbatore', 'TBM-006'),

    -- Bangalore SRs â†’ TBM-007
    ('SR-010', 'sr_suresh', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Suresh Gowda', 'suresh.g@appasamy.com', '9840000049',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2003, 'Bangalore', 'TBM-007'),

    ('SR-011', 'sr_pooja', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Pooja Shetty', 'pooja.s@appasamy.com', '9840000050',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2003, 'Bangalore', 'TBM-007'),

    -- Kochi SRs â†’ TBM-008
    ('SR-012', 'sr_anil', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Anil Varghese', 'anil.v@appasamy.com', '9840000051',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2004, 'Kochi', 'TBM-008'),

    ('SR-013', 'sr_reshma', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Reshma Pillai', 'reshma.p@appasamy.com', '9840000052',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2004, 'Kochi', 'TBM-008'),

    ('SR-014', 'sr_manoj', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'Manoj Krishnan', 'manoj.k@appasamy.com', '9840000053',
     'sales_rep', 'Sales Representative',
     2, 'Southern Zone', 202, 'Karnataka & Kerala', 2004, 'Kochi', 'TBM-008'),

    -- â”€â”€ ADMIN (system admin, no hierarchy) â”€â”€
    ('ADM-001', 'admin', '$2b$10$YourBcryptHashHere000000000000000000000000000000',
     'System Admin', 'admin@appasamy.com', '9840000099',
     'admin', 'System Administrator',
     NULL, NULL, NULL, NULL, NULL, 'System', NULL)

ON CONFLICT (employee_code) DO NOTHING;

-- Add self-referential FK on reports_to AFTER seed (avoids ordering issues)
-- Using a DO block so it doesn't fail if constraint already exists
DO $$ BEGIN
  ALTER TABLE target_setting.auth_users
    ADD CONSTRAINT fk_au_reports_to
    FOREIGN KEY (reports_to) REFERENCES target_setting.auth_users(employee_code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;



CREATE TABLE IF NOT EXISTS target_setting.user_sessions (
    id              SERIAL       PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES target_setting.auth_users(id) ON DELETE CASCADE,
    token_jti       VARCHAR(64)  NOT NULL UNIQUE,              -- JWT ID for revocation
    refresh_token   VARCHAR(255),                              -- Refresh token (hashed)
    device_info     VARCHAR(255),                              -- User agent / device
    ip_address      INET,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    revoked_at      TIMESTAMPTZ                                -- NULL = active; set = revoked
);

CREATE INDEX IF NOT EXISTS idx_us_user    ON target_setting.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_us_jti     ON target_setting.user_sessions(token_jti);
CREATE INDEX IF NOT EXISTS idx_us_active  ON target_setting.user_sessions(expires_at)
                                         WHERE revoked_at IS NULL;

COMMENT ON TABLE target_setting.user_sessions IS 'JWT session tracking. token_jti is the JWT ID. revoked_at IS NULL means session is active. refresh_token for token rotation.';




CREATE TABLE IF NOT EXISTS target_setting.product_categories (
    id              VARCHAR(30)  PRIMARY KEY,                  -- 'equipment','iol','ovd','pharma','consumables','mis','msi','others'
    name            VARCHAR(50)  NOT NULL,                     -- Display name
    icon            VARCHAR(30),                               -- FontAwesome class e.g. 'fa-microscope'
    color_class     VARCHAR(30),                               -- CSS class for theming
    is_revenue_only BOOLEAN      NOT NULL DEFAULT FALSE,       -- TRUE = no qty tracking, only â‚¹ (MIS, Others)
    display_order   INTEGER      NOT NULL DEFAULT 0,           -- Sort order in UI
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE target_setting.product_categories IS 
'Product categories: Equipment, IOL, OVD, Pharma, Consumables, MIS, MSI, Others.
MIS & Others are revenue-only (is_revenue_only=TRUE â†’ no unit quantities, only â‚¹ values).';


INSERT INTO target_setting.product_categories (id, name, icon, color_class, is_revenue_only, display_order)
VALUES
    ('equipment',   'Equipment',               'fa-microscope', 'equipment',   FALSE, 1),
    ('iol',         'IOL',                     'fa-eye',        'iol',         FALSE, 2),
    ('ovd',         'OVD',                     'fa-tint',       'ovd',         FALSE, 3),
    ('pharma',      'Pharma',                  'fa-pills',      'pharma',      FALSE, 4),
    ('consumables', 'Consumables/Accessories', 'fa-box-open',   'consumables', FALSE, 5),
    ('mis',         'MIS',                     'fa-chart-line', 'mis',         TRUE,  6),
    ('msi',         'MSI',                     'fa-tools',      'msi',         FALSE, 7),
    ('others',      'Others',                  'fa-boxes',      'others',      TRUE,  8)
ON CONFLICT (id) DO NOTHING;


CREATE TABLE IF NOT EXISTS target_setting.product_category_map (
    id              SERIAL       PRIMARY KEY,
    product_code    VARCHAR(50)  NOT NULL,                     -- Product code from AOP
    category_id     VARCHAR(30)  NOT NULL REFERENCES target_setting.product_categories(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pcm UNIQUE (product_code, category_id)
);

CREATE INDEX IF NOT EXISTS idx_pcm_code ON target_setting.product_category_map(product_code);
CREATE INDEX IF NOT EXISTS idx_pcm_cat  ON target_setting.product_category_map(category_id);

COMMENT ON TABLE target_setting.product_category_map IS 'Maps product codes (from AOP) to target_setting categories. A product can belong to multiple categories.';

CREATE TABLE IF NOT EXISTS target_setting.role_product_access (
    id              SERIAL       PRIMARY KEY,
    role            target_setting.user_role NOT NULL,
    category_id     VARCHAR(30)  NOT NULL REFERENCES target_setting.product_categories(id),
    can_view        BOOLEAN      NOT NULL DEFAULT TRUE,
    can_commit      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rpa UNIQUE (role, category_id)
);

COMMENT ON TABLE target_setting.role_product_access IS 'Controls which roles can view and/or commit targets for each product category.';


INSERT INTO target_setting.role_product_access (role, category_id)
SELECT r.role, c.id
FROM (VALUES
    ('sales_rep'::target_setting.user_role), ('tbm'::target_setting.user_role),
    ('abm'::target_setting.user_role),       ('zbm'::target_setting.user_role),
    ('sales_head'::target_setting.user_role)
) AS r(role)
CROSS JOIN target_setting.product_categories c
WHERE c.is_active = TRUE
ON CONFLICT DO NOTHING;



CREATE TABLE IF NOT EXISTS target_setting.product_pricing (
    id              SERIAL       PRIMARY KEY,
    product_code    VARCHAR(50)  NOT NULL,                     -- Must match AOP product code
    product_name    VARCHAR(255) NOT NULL,
    category_id     VARCHAR(30)  REFERENCES target_setting.product_categories(id),
    subcategory     VARCHAR(100),                              -- e.g. 'Diagnostic', 'Surgical'
    unit_cost       NUMERIC(18,2) NOT NULL,                    -- Price per unit in INR (â‚¹)
    currency        VARCHAR(5)   NOT NULL DEFAULT 'INR',
    effective_from  DATE         NOT NULL DEFAULT CURRENT_DATE,-- Price effective date
    effective_to    DATE,                                      -- NULL = currently active price
    fiscal_year_code VARCHAR(20),                              -- Optional: tie pricing to FY
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Only one active price per product per FY period
    CONSTRAINT uq_pricing UNIQUE (product_code, effective_from, fiscal_year_code)
);

CREATE INDEX IF NOT EXISTS idx_pp_product   ON target_setting.product_pricing(product_code);
CREATE INDEX IF NOT EXISTS idx_pp_category  ON target_setting.product_pricing(category_id);
CREATE INDEX IF NOT EXISTS idx_pp_active    ON target_setting.product_pricing(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE target_setting.product_pricing IS 
'Unit costs per product for auto qtyâ†’value conversion in target sheets.
Supports price versioning via effective_from/to dates and optional FY scoping.
Admin screen manages these prices (quota prices).';

CREATE TABLE IF NOT EXISTS target_setting.product_commitments (
    id                  BIGSERIAL    PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,                 -- 'FY26_27' references fiscal_years.code

    -- WHO (snapshot at creation for fast queries)
    employee_code       VARCHAR(20)  NOT NULL,
    employee_name       VARCHAR(150),
    employee_role       target_setting.user_role NOT NULL,

    -- WHAT
    product_code        VARCHAR(50)  NOT NULL,
    product_name        VARCHAR(255),
    category_id         VARCHAR(30)  REFERENCES target_setting.product_categories(id),
    unit                VARCHAR(20)  DEFAULT 'Units',

    -- WHERE (geography snapshot for drill-down queries)
    zone_code           INTEGER,
    zone_name           VARCHAR(100),
    area_code           INTEGER,
    area_name           VARCHAR(100),
    territory_code      INTEGER,
    territory_name      VARCHAR(150),


    monthly_targets     JSONB        NOT NULL DEFAULT '{}',

   
    status              target_setting.commitment_status NOT NULL DEFAULT 'draft',
    submitted_at        TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    approved_by_code    VARCHAR(20),                           -- Employee code of approver
    approved_by_name    VARCHAR(150),


    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),


    CONSTRAINT uq_commitment UNIQUE (fiscal_year_code, employee_code, product_code)
);

CREATE INDEX IF NOT EXISTS idx_pc_fy        ON target_setting.product_commitments(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_pc_emp       ON target_setting.product_commitments(employee_code);
CREATE INDEX IF NOT EXISTS idx_pc_status    ON target_setting.product_commitments(status);
CREATE INDEX IF NOT EXISTS idx_pc_category  ON target_setting.product_commitments(category_id);
CREATE INDEX IF NOT EXISTS idx_pc_product   ON target_setting.product_commitments(product_code);
CREATE INDEX IF NOT EXISTS idx_pc_zone      ON target_setting.product_commitments(zone_code);
CREATE INDEX IF NOT EXISTS idx_pc_area      ON target_setting.product_commitments(area_code);
CREATE INDEX IF NOT EXISTS idx_pc_territory ON target_setting.product_commitments(territory_code);
CREATE INDEX IF NOT EXISTS idx_pc_sub       ON target_setting.product_commitments(submitted_at)
                                           WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS idx_pc_gin       ON target_setting.product_commitments
                                           USING GIN (monthly_targets);

COMMENT ON TABLE target_setting.product_commitments IS 
'Core table: product commitment entries. Each row = one employee Ã— one product Ã— one fiscal year.
Monthly targets stored as JSONB with 12 months of LY/CY qty and revenue.
Workflow: not_started â†’ draft (editable) â†’ submitted (locked) â†’ approved (finalized).
Geography (zone/area/territory) denormalized for fast aggregate queries at every hierarchy level.';
COMMENT ON COLUMN target_setting.product_commitments.monthly_targets IS 
'JSONB structure: {"apr":{"lyQty":N,"cyQty":N,"lyRev":N,"cyRev":N}, ... "mar":{...}}
For revenue-only categories (MIS/Others), only lyRev and cyRev are meaningful (no qty).';



CREATE TABLE IF NOT EXISTS target_setting.commitment_approvals (
    id                  BIGSERIAL    PRIMARY KEY,
    commitment_id       BIGINT       NOT NULL
                        REFERENCES target_setting.product_commitments(id) ON DELETE CASCADE,
    action              target_setting.approval_action NOT NULL,
    actor_code          VARCHAR(20)  NOT NULL,                  -- Who performed this action
    actor_name          VARCHAR(150),
    actor_role          target_setting.user_role NOT NULL,
    corrections         JSONB,                                  -- Manager corrections: {"aug":{"cyQty":150}}
    original_values     JSONB,                                  -- Snapshot before correction for audit
    comments            TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ca_commit  ON target_setting.commitment_approvals(commitment_id);
CREATE INDEX IF NOT EXISTS idx_ca_actor   ON target_setting.commitment_approvals(actor_code);
CREATE INDEX IF NOT EXISTS idx_ca_ts      ON target_setting.commitment_approvals(created_at DESC);

COMMENT ON TABLE target_setting.commitment_approvals IS 
'Immutable audit trail for every approval action. Stores corrections (JSONB diff) and original_values (pre-correction snapshot).
No reject cycle â€” managers correct and approve directly. Actions: submitted, approved, corrected_and_approved, bulk_approved.';


CREATE TABLE IF NOT EXISTS target_setting.yearly_target_assignments (
    id                  SERIAL       PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,
    manager_code        VARCHAR(20)  NOT NULL,
    manager_role        target_setting.user_role NOT NULL,
    assignee_code       VARCHAR(20)  NOT NULL,
    assignee_name       VARCHAR(150),
    assignee_role       target_setting.user_role NOT NULL,
    assignee_territory  VARCHAR(150),

    -- Yearly aggregates (LY reference + CY target)
    ly_target_qty       NUMERIC(15,2) DEFAULT 0,
    ly_achieved_qty     NUMERIC(15,2) DEFAULT 0,
    ly_target_value     NUMERIC(18,2) DEFAULT 0,
    ly_achieved_value   NUMERIC(18,2) DEFAULT 0,
    cy_target_qty       NUMERIC(15,2) DEFAULT 0,
    cy_target_value     NUMERIC(18,2) DEFAULT 0,

    -- Category-level breakdown (JSON for expandable accordion UI)
    category_breakdown  JSONB         DEFAULT '[]',

    status              target_setting.assignment_status NOT NULL DEFAULT 'not_set',
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_yta UNIQUE (fiscal_year_code, manager_code, assignee_code)
);

CREATE INDEX IF NOT EXISTS idx_yta_fy      ON target_setting.yearly_target_assignments(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_yta_mgr     ON target_setting.yearly_target_assignments(manager_code);
CREATE INDEX IF NOT EXISTS idx_yta_asgn    ON target_setting.yearly_target_assignments(assignee_code);
CREATE INDEX IF NOT EXISTS idx_yta_status  ON target_setting.yearly_target_assignments(status);

COMMENT ON TABLE target_setting.yearly_target_assignments IS 
'Top-down yearly target allocation. Managers set total yearly targets for each team member.
TBMâ†’Sales Reps, ABMâ†’TBMs, ZBMâ†’ABMs, Sales Headâ†’ZBMs.
category_breakdown stores per-category details as JSONB for the yearly summary accordion view.';



CREATE TABLE IF NOT EXISTS target_setting.team_product_targets (
    id                  BIGSERIAL    PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,
    manager_code        VARCHAR(20)  NOT NULL,
    manager_role        target_setting.user_role NOT NULL,
    member_code         VARCHAR(20)  NOT NULL,
    member_name         VARCHAR(150),
    product_code        VARCHAR(50)  NOT NULL,
    product_name        VARCHAR(255),
    category_id         VARCHAR(30)  REFERENCES target_setting.product_categories(id),

    monthly_targets     JSONB        NOT NULL DEFAULT '{}',

    status              target_setting.assignment_status NOT NULL DEFAULT 'not_set',
    assigned_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_tpt UNIQUE (fiscal_year_code, manager_code, member_code, product_code)
);

CREATE INDEX IF NOT EXISTS idx_tpt_fy      ON target_setting.team_product_targets(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tpt_mgr     ON target_setting.team_product_targets(manager_code);
CREATE INDEX IF NOT EXISTS idx_tpt_member  ON target_setting.team_product_targets(member_code);

COMMENT ON TABLE target_setting.team_product_targets IS 
'Product-level monthly targets assigned by managers to team members.
monthly_targets JSONB follows same structure as product_commitments for consistency.';



CREATE TABLE IF NOT EXISTS target_setting.audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    actor_code      VARCHAR(20)  NOT NULL,
    actor_role      target_setting.user_role,
    action          VARCHAR(50)  NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       BIGINT,
    detail          JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_al_actor  ON target_setting.audit_log(actor_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_entity ON target_setting.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_al_ts     ON target_setting.audit_log(created_at DESC);

COMMENT ON TABLE target_setting.audit_log IS 'Immutable audit trail for all changes. Captures who did what, when, and the context/diff as JSONB detail.';



CREATE TABLE IF NOT EXISTS target_setting.notifications (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES target_setting.auth_users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    message         TEXT,
    type            VARCHAR(30)  DEFAULT 'info',
    related_entity  VARCHAR(50),
    related_id      BIGINT,
    is_read         BOOLEAN      DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON target_setting.notifications(user_id, is_read) WHERE is_read = FALSE;

COMMENT ON TABLE target_setting.notifications IS 'Activity feed / notification center. Shows submission alerts, approval notifications, deadline reminders etc.';



CREATE OR REPLACE FUNCTION target_setting.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'auth_users','fiscal_years','product_commitments',
    'yearly_target_assignments','team_product_targets','product_pricing'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated ON target_setting.%I; '
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON target_setting.%I '
      'FOR EACH ROW EXECUTE FUNCTION target_setting.fn_set_updated_at()',
      t, t, t, t);
  END LOOP;
END $$;



-- Function: Get full subordinate tree under an employee (recursive CTE)
CREATE OR REPLACE FUNCTION target_setting.fn_get_subordinates(root_emp_code VARCHAR)
RETURNS TABLE(
    employee_code VARCHAR, full_name VARCHAR, role target_setting.user_role,
    zone_name VARCHAR, area_name VARCHAR, territory_name VARCHAR,
    reports_to VARCHAR, depth INT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE hierarchy AS (
        SELECT u.employee_code, u.full_name, u.role,
               u.zone_name, u.area_name, u.territory_name,
               u.reports_to, 0 AS depth
        FROM target_setting.auth_users u
        WHERE u.employee_code = root_emp_code AND u.is_active = TRUE

        UNION ALL

        SELECT u.employee_code, u.full_name, u.role,
               u.zone_name, u.area_name, u.territory_name,
               u.reports_to, h.depth + 1
        FROM target_setting.auth_users u
        JOIN hierarchy h ON u.reports_to = h.employee_code
        WHERE u.is_active = TRUE
    )
    SELECT * FROM hierarchy ORDER BY depth, full_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION target_setting.fn_get_subordinates IS 'Returns full org tree under a given employee_code. Recursive CTE walks the reports_to chain.';

-- Function: Get DIRECT reports only (one level down)
CREATE OR REPLACE FUNCTION target_setting.fn_get_direct_reports(manager_emp_code VARCHAR)
RETURNS TABLE(
    employee_code VARCHAR, full_name VARCHAR, role target_setting.user_role,
    designation VARCHAR, email VARCHAR, phone VARCHAR,
    zone_name VARCHAR, area_name VARCHAR, territory_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.employee_code, u.full_name, u.role,
           u.designation, u.email, u.phone,
           u.zone_name, u.area_name, u.territory_name
    FROM target_setting.auth_users u
    WHERE u.reports_to = manager_emp_code AND u.is_active = TRUE
    ORDER BY u.full_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION target_setting.fn_get_direct_reports IS 'Returns immediate direct reports of a manager. Used for approval screens and team views.';

-- Function: Calculate growth percentage safely (handles zero/null)
CREATE OR REPLACE FUNCTION target_setting.fn_calc_growth(ly_value NUMERIC, cy_value NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    IF ly_value = 0 OR ly_value IS NULL THEN RETURN 0; END IF;
    RETURN ROUND(((cy_value - ly_value) / ly_value) * 100, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Get active unit price for a product
CREATE OR REPLACE FUNCTION target_setting.fn_get_unit_price(p_product_code VARCHAR, p_date DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC AS $$
BEGIN
    RETURN (
        SELECT unit_cost
        FROM target_setting.product_pricing
        WHERE product_code = p_product_code
          AND is_active = TRUE
          AND effective_from <= p_date
          AND (effective_to IS NULL OR effective_to >= p_date)
        ORDER BY effective_from DESC
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION target_setting.fn_get_unit_price IS 'Returns the active unit price for a product on a given date. Used for qtyâ†’value conversion.';


-- View: Pending approvals (submissions awaiting review)
CREATE OR REPLACE VIEW target_setting.v_pending_approvals AS
SELECT pc.*, cat.name AS category_name
FROM   target_setting.product_commitments pc
LEFT   JOIN target_setting.product_categories cat ON cat.id = pc.category_id
WHERE  pc.status = 'submitted';

COMMENT ON VIEW target_setting.v_pending_approvals IS 'All commitments with status=submitted. Used by TBM/ABM/ZBM/SH approval screens.';

-- View: Zone-level stats (for Sales Head / ZBM dashboards)
CREATE OR REPLACE VIEW target_setting.v_zone_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   target_setting.product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name;

-- View: Area-level stats (for ABM dashboards)
CREATE OR REPLACE VIEW target_setting.v_area_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       area_code, area_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   target_setting.product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name, area_code, area_name;

-- View: Territory-level stats (for TBM dashboards)
CREATE OR REPLACE VIEW target_setting.v_territory_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       area_code, area_name, territory_code, territory_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   target_setting.product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name,
          area_code, area_name, territory_code, territory_name;

-- View: Organization hierarchy (for Admin org-tree & frontend hierarchy displays)
CREATE OR REPLACE VIEW target_setting.v_org_hierarchy AS
SELECT 
    u.id,
    u.employee_code,
    u.full_name,
    u.role,
    u.designation,
    u.email,
    u.phone,
    u.zone_name,
    u.area_name,
    u.territory_name,
    u.reports_to,
    u.is_active,
    mgr.full_name AS manager_name,
    mgr.role      AS manager_role,
    (SELECT COUNT(*) FROM target_setting.auth_users sub 
     WHERE sub.reports_to = u.employee_code AND sub.is_active = TRUE) AS direct_report_count
FROM target_setting.auth_users u
LEFT JOIN target_setting.auth_users mgr ON mgr.employee_code = u.reports_to
WHERE u.is_active = TRUE
ORDER BY 
    CASE u.role
        WHEN 'sales_head' THEN 1
        WHEN 'zbm' THEN 2
        WHEN 'abm' THEN 3
        WHEN 'tbm' THEN 4
        WHEN 'sales_rep' THEN 5
        ELSE 6
    END,
    u.full_name;

COMMENT ON VIEW target_setting.v_org_hierarchy IS 
'Full org chart view with manager name, role, and count of direct reports.
Used by Admin hierarchy manager and frontend org-tree displays.';


COMMIT;
