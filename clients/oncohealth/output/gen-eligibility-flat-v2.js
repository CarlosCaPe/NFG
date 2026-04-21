// #!/usr/bin/env node
// gen-eligibility-flat-v2.js — EligibilityFlat reference guide for Miro editing
// Source of truth: clients/oncohealth/output/case domain svg.txt (Miro SVG export)
// NOT Silver schema. NOT Databricks. Miro only.
// Usage: node clients/oncohealth/output/gen-eligibility-flat-v2.js

const fs   = require('fs');
const path = require('path');
const OUT  = path.join(__dirname, 'eligibility-flat-miro-v2.svg');

// [constraint, name, type, group, status, note]
// constraint : 'PK' | 'FK' | ''
// status     : 'KEEP' | 'FK' | 'ADD' | 'REVIEW' | 'REORDER'
//   KEEP    = in Miro, correct position, no action
//   FK      = FK reference to another entity
//   ADD     = not in Miro at all -> insert new row
//   REVIEW  = ambiguous, needs team clarification
//   REORDER = in Miro but WRONG position.
//             Badge shows: 'era pos #X Miro | <- source'
//             Action: go to pos X in Miro -> delete -> insert here (in this group)
//
// DELETED from Miro (not in COLUMNS):
//   PatientHomePhoneExt, PatientMobilePhoneExt  - no source
//   IsERISA, IsFEHBPlan                          - no source
//   LineOfBusinessVersion, CardId                - no source
//   PatientAdressVersion                         - concurrency token, deleted
//   BenefitPackageVersion                        - version token, deleted
//   SuppressLetters, LetterSuppressionDate        - no source
//   CustomFields                                 - no source
//   PatientId, Type                              - covered by MemberId / redundant
//
// Miro positions (#X) reference the 0-indexed text-element dump from svg.txt

const COLUMNS = [

  // -- System ------------------------------------------------------------------
  ['PK', 'Key',                              'guid',              'System',         'KEEP',    '<- eligibility_key'],
  ['',   'IsDeleted',                        'bool',              'System',         'KEEP',    '<- __is_deleted / Deleted'],
  ['',   'DeletedBy',                        'string',            'System',         'KEEP',    '<- DeletedBy (soft-delete audit)'],
  ['',   'DeletedOn',                        'dt',                'System',         'KEEP',    '<- DeletedOn (soft-delete audit)'],
  ['',   'StartAt',                          'dt',                'System',         'KEEP',    '<- __start_at (Delta SCD)'],
  ['',   'EndAt',                            'nullable dt',       'System',         'KEEP',    '<- __end_at (Delta SCD)'],

  // -- Member ------------------------------------------------------------------
  ['FK', 'RelatedPersonKey',                 'FK',                'Member',         'FK',      '-> RelatedPerson entity'],
  ['FK', 'RelatedPersonAdressKey',           'FK',                'Member',         'FK',      '-> RelatedPerson address [typo in Miro]'],
  ['',   'MemberId',                         'string',            'Member',         'KEEP',    '<- MemberID'],
  ['',   'PatientFirstName',                 'string',            'Member',         'KEEP',    '<- FirstName'],
  ['',   'PatientLastName',                  'string',            'Member',         'KEEP',    '<- LastName'],
  ['',   'PatientMiddleInitial',             'string',            'Member',         'KEEP',    '<- MiddleInitial'],
  ['',   'PatientGender',                    'enum',              'Member',         'KEEP',    '<- Gender'],
  ['',   'PatientDateOfBirth',               'dt',                'Member',         'KEEP',    '<- BirthDate'],
  ['',   'PatientSSN',                       'nullable string',   'Member',         'KEEP',    '<- SubscriberSSN (PII)'],
  ['',   'DependentSSN',                     'nullable string',   'Member',         'KEEP',    '<- DependentSSN (PII)'],
  ['FK', 'PatientAddressKey',                'FK',                'Member',         'FK',      '-> address entity'],
  ['',   'MemberReportingId',                'string',            'Member',         'KEEP',    '<- ODSMemberGeneratedKey'],
  ['',   'MedicaidNumber',                   'string',            'Member',         'KEEP',    '<- MedicaidNumber'],
  ['',   'MedicareBeneficiaryId',            'string',            'Member',         'KEEP',    '<- MedicareBeneficiaryID'],

  // -- Contact -----------------------------------------------------------------
  ['',   'PatientHomePhone',                 'string',            'Contact',        'KEEP',    '<- Phone'],
  ['',   'PatientWorkPhone',                 'string',            'Contact',        'KEEP',    '<- WorkPhone'],
  ['',   'PatientWorkPhoneExt',              'string',            'Contact',        'KEEP',    '<- WorkPhoneExtension'],
  ['',   'PatientMobilePhone',               'string',            'Contact',        'KEEP',    '<- MobilePhone'],
  ['',   'PatientPreferredLanguageCode',     'int',               'Contact',        'KEEP',    '<- PreferredLanguageCodeID'],

  // -- Payer -------------------------------------------------------------------
  ['FK', 'PayerKey',                         'FK',                'Payer',          'FK',      '-> Payer entity'],
  ['',   'PayerId',                          'int',               'Payer',          'KEEP',    '<- InsuranceProviderID'],
  ['',   'CarrierId',                        'string',            'Payer',          'KEEP',    '<- CarrierID'],
  ['',   'AccountId',                        'string',            'Payer',          'KEEP',    '<- AccountID'],
  ['',   'InsuranceGroupId',                 'string',            'Payer',          'KEEP',    '<- GroupID'],
  ['',   'EligibilitySource',                'enum: NewUM, ETL',  'Payer',          'KEEP',    '<- EligibilitySource'],
  ['',   'PlatformCode',                     'string',            'Payer',          'KEEP',    '<- PlatformCode'],
  ['',   'LegacySystemSourceCustomerCoverageKey','string',        'Payer',          'KEEP',    '<- LegacySystemSourceCustomerCoverageKey'],

  // -- Plan --------------------------------------------------------------------
  ['',   'PlanDescription',                  'string',            'Plan',           'KEEP',    '<- PlanDescription'],
  ['',   'AsoIndicator',                     'bool',              'Plan',           'KEEP',    '<- ASOIndicator'],
  ['',   'LegacySystemSourceProdPlanKey',    'string',            'Plan',           'KEEP',    '<- LegacySystemSourceProdPlanKey'],
  ['',   'SellingLedger',                    'string',            'Plan',           'KEEP',    '<- SellingLedger'],
  ['',   'FormularyName',                    'string',            'Plan',           'KEEP',    '<- FormularyName'],

  // -- Product -----------------------------------------------------------------
  ['FK', 'ProductKey',                       'FK',                'Product',        'FK',      '-> Product entity'],
  ['',   'PharmacyGroupId',                  'string',            'Product',        'KEEP',    '<- PharmacyGroupID'],
  ['',   'SpanType',                         'enum',              'Product',        'KEEP',    '<- SegID'],
  ['',   'ProductType',                      'string',            'Product',        'KEEP',    '<- ProductType'],
  ['',   'PBPID',                            'string',            'Product',        'KEEP',    '<- PBPID'],
  ['',   'RiskArrangement',                  'string',            'Product',        'KEEP',    '<- RiskArrangement'],
  ['',   'ExchangeIdentifier',               'bool',              'Product',        'KEEP',    '<- ExchangeIdentifier (ACA flag)'],
  ['',   'SpecialtyIndicator',               'bool',              'Product',        'KEEP',    '<- SpecialtyIndicator'],
  ['',   'ProductOfferCode',                 'string',            'Product',        'KEEP',    '<- ProductOfferCode'],
  ['',   'ProductLine',                      'string',            'Product',        'KEEP',    '<- ProductLine'],

  // -- Coverage ----------------------------------------------------------------
  ['',   'RelationshipCode',                 'string',            'Coverage',       'KEEP',    '<- RelationshipCodeID'],
  ['',   'CoverageTypeCode',                 'string',            'Coverage',       'KEEP',    '<- CoverageTypeID'],
  ['',   'CoverageStart',                    'date',              'Coverage',       'KEEP',    '<- CoverageEffectiveDate'],
  ['',   'CoverageEnd',                      'date',              'Coverage',       'KEEP',    '<- CoverageEndDate'],

  // -- Benefits ----------------------------------------------------------------
  ['',   'MemberBenefit',                    'enum',              'Benefits',       'REVIEW',  'REVIEW: Miro=enum(Medical,Pharmacy,MedicalAndPharmacy). Silver=2 bools (medical_benefit_indicator + rx_benefit_indicator). Nick: functionally equivalent, prefers split.'],
  ['',   'HasOutOfNetworkBenefit',           'bool',              'Benefits',       'KEEP',    '<- OutOfNetworkBenefit'],
  ['',   'IsRxCarvedOut',                    'bool',              'Benefits',       'KEEP',    '<- PrescriptionBenefitCarveOutIndicator'],
  ['',   'RxCarveOutStartDate',              'date',              'Benefits',       'KEEP',    '<- PrescriptionBenefitCarveOutEffectiveStartDate'],
  ['',   'RxCarveOutEndDate',               'date',              'Benefits',       'KEEP',    '<- PrescriptionBenefitCarveOutEffectiveEndDate'],
  ['',   'RiskPatient',                      'bool',              'Benefits',       'KEEP',    '<- is_medicare_advantage_risk_patient | Medicare Advantage enrollment flag'],
  ['',   'DualEligibilityStatus',            'string',            'Benefits',       'KEEP',    '<- dual_eligibility_indicator | NOTE: Silver=bool, Miro=string — type mismatch'],
  ['',   'IsErisa',                          'bool',              'Benefits',       'ADD',     '<- is_erisa (BenefitPackage) | ERISA plan flag'],
  ['',   'IsFehbPlan',                       'bool',              'Benefits',       'ADD',     '<- is_fehb_plan (BenefitPackage) | Federal Employee Health Benefit flag'],

  // -- LOB ---------------------------------------------------------------------
  ['',   'MajorLineOfBusiness',              'string',            'LOB',            'KEEP',    '<- MajorLineOfBusiness'],
  ['',   'AccessibilityPreference',          'string',            'LOB',            'KEEP',    '<- AccessibilityPreference'],

  // -- Network -----------------------------------------------------------------
  ['',   'StateOfPlanIssue',                 'string',            'Network',        'KEEP',    '<- StateOfIssue'],
  ['',   'IsOutOfArea',                      'bool',              'Network',        'KEEP',    '<- OutOfArea'],
  ['',   'OutOfAreaCategory',                'string',            'Network',        'KEEP',    '<- OutOfAreaCategory'],
  ['',   'LeasedNetworkCode',                'string',            'Network',        'KEEP',    '<- LeasedNetworkCode'],
  ['',   'ServiceFundPCPCenterLedger',       'string',            'Network',        'KEEP',    '<- ServiceFundPCPCenterLedger'],
  ['',   'ConsolidatedMarketNumber',         'string',            'Network',        'KEEP',    '<- ConsolidatedMarketNumber'],
  ['',   'RadiologyMktName',                 'string',            'Network',        'KEEP',    '<- RadiologyMktName'],
  ['',   'PCPGrouperNumber',                 'string',            'Network',        'KEEP',    '<- PCPGrouperNumber'],
  ['',   'PsychCode',                        'string',            'Network',        'KEEP',    '<- PsychCode'],
  ['',   'CountyCode',                       'string',            'Network',        'KEEP',    '<- CountyCode'],
  ['',   'ServFundLOBCode',                  'string',            'Network',        'KEEP',    '<- ServFundLOBCode'],

  // -- Group -------------------------------------------------------------------
  ['FK', 'EmployerGroupKey',                 'FK',                'Group',          'FK',      '-> Group entity'],
  ['FK', 'EmployerGroupAddressKey',          'FK',                'Group',          'FK',      '-> Group address entity'],
  ['',   'ContractNumber',                   'string',            'Group',          'KEEP',    '<- ContractNumber'],
  ['',   'EmployerGroupName',                'string',            'Group',          'KEEP',    '<- GroupName'],
  ['',   'ContractEffectiveDate',            'dt',                'Group',          'KEEP',    '<- GroupContractEffectiveDate'],
  ['',   'ContractTerminationDate',          'dt',                'Group',          'KEEP',    '<- GroupContractEndDate'],
  ['',   'ActionIndicator',                  'string',            'Group',          'KEEP',    '<- ActionIndicator (CDC/delta flag)'],

  // -- Financial ---------------------------------------------------------------
  ['',   'FinProdCode',                      'string',            'Financial',      'KEEP',    '<- FinProdCode'],
  ['',   'FinSubCode',                       'string',            'Financial',      'KEEP',    '<- FinSubCode'],
  ['',   'LegalEntity',                      'string',            'Financial',      'KEEP',    '<- LegalEntity'],
  ['',   'Division',                         'string',            'Financial',      'KEEP',    '<- Division'],

  // -- PCP ---------------------------------------------------------------------
  ['',   'PCPName',                          'string',            'PCP',            'KEEP',    '<- PCPName'],
  ['',   'PCPID',                            'string',            'PCP',            'KEEP',    '<- PCPID'],
  ['',   'PCPEffectiveDate',                 'dt',                'PCP',            'KEEP',    '<- PCPEffectiveDate'],

  // -- Representative ----------------------------------------------------------
  ['',   'HasRepresentative',                'bool',              'Representative', 'KEEP',    '<- AppointmentOfRepresentative'],
  ['',   'RepresentativeFirstName',          'string',            'Representative', 'KEEP',    '<- RepresentativeFirstName'],
  ['',   'RepresentativeLastName',           'string',            'Representative', 'KEEP',    '<- RepresentativeLastName'],
  ['',   'RepresentativeAddressLine1',       'string',            'Representative', 'KEEP',    '<- RepresentativeAddressLine1'],
  ['',   'RepresentativeAddressLine2',       'string',            'Representative', 'KEEP',    '<- RepresentativeAddressLine2'],
  ['',   'RepresentativeCity',               'string',            'Representative', 'KEEP',    '<- RepresentativeCity'],
  ['',   'RepresentativeState',              'string',            'Representative', 'KEEP',    '<- RepresentativeState'],
  ['',   'RepresentativeZipCode',            'string',            'Representative', 'KEEP',    '<- RepresentativeZipCode'],
  ['',   'RepresentativeZipPlusCode',        'string',            'Representative', 'KEEP',    '<- RepresentativeZipPlusCode'],
  ['FK', 'RepresentativeRelationshipCodeID', 'int',               'Representative', 'FK',      '<- RepresentativeRelationshipCodeID (FK -> ref)'],
  ['',   'RepresentativeHomePhone',          'string',            'Representative', 'KEEP',    '<- RepresentativeHomePhone'],
  ['',   'RepresentativeWorkPhone',          'string',            'Representative', 'KEEP',    '<- RepresentativeWorkPhone'],
  ['',   'RepresentativeWorkPhoneExtension', 'string',            'Representative', 'KEEP',    '<- RepresentativeWorkPhoneExtension'],

  // -- Audit -------------------------------------------------------------------
  ['',   'Checksum',                         'int',               'Audit',          'KEEP',    '<- Checksum (change-detection)'],
  ['',   'HashValue',                        'string',            'Audit',          'KEEP',    '<- HashValue (row dedup hash)'],
];

// -- Silver Databricks mapping -----------------------------------------------
// [silverTable, silverCol, silverStatus]
// silverStatus: 'OK' | 'WARN' | 'EXCL' | 'NEW'
//   OK   = confirmed mapped in Silver analysis
//   WARN = pending/unresolved question OR field has no Silver column yet (gap)
//   EXCL = intentionally excluded (PHI, duplicate, ETL-metadata)
//   NEW  = Silver-infra-only field (SCD2 __is_deleted etc.) — correct to omit from app
const SILVER = {
  // System
  'Key':                               ['Elig',  'eligibility_key',                    'OK'],
  'IsDeleted':                         ['Elig',  '__is_deleted',                       'NEW'],
  'DeletedBy':                         [null,    null,                                 'WARN'],
  'DeletedOn':                         [null,    null,                                 'WARN'],
  'StartAt':                           ['Elig',  '__start_at',                         'NEW'],
  'EndAt':                             ['Elig',  '__end_at',                           'NEW'],
  // Member
  'RelatedPersonKey':                  ['Elig',  'member_representative_key',          'OK'],
  'RelatedPersonAdressKey':            ['—',     'EXCL: dup of RelatedPerson.addr_key','EXCL'],
  'MemberId':                          ['Elig',  'member_id',                          'OK'],
  'PatientFirstName':                  ['Elig',  'first_name',                         'OK'],
  'PatientLastName':                   ['Elig',  'last_name',                          'OK'],
  'PatientMiddleInitial':              ['Elig',  'middle_name',                        'OK'],
  'PatientGender':                     ['Elig',  'gender_code',                        'OK'],
  'PatientDateOfBirth':                ['Elig',  'date_of_birth',                      'OK'],
  'PatientSSN':                        ['—',     'EXCL: PHI — dropped',                'EXCL'],
  'DependentSSN':                      [null,    null,                                 'WARN'],
  'PatientAddressKey':                 ['Elig',  'mailing_address_key',                'OK'],
  'MemberReportingId':                 [null,    null,                                 'WARN'],
  'MedicaidNumber':                    ['Elig',  'medicaid_id',                        'OK'],
  'MedicareBeneficiaryId':             ['Elig',  'medicare_beneficiary_id',            'OK'],
  // Contact
  'PatientHomePhone':                  ['Elig',  'phone_1_number',                     'OK'],
  'PatientWorkPhone':                  ['Elig',  'phone_2_number',                     'OK'],
  'PatientWorkPhoneExt':               ['Elig',  'phone_2_extension',                  'OK'],
  'PatientMobilePhone':                ['Elig',  'phone_arrays',                       'OK'],
  'PatientPreferredLanguageCode':      ['Elig',  'preferred_language_code',            'OK'],
  // Payer
  'PayerKey':                          [null,    null,                                 'WARN'],
  'PayerId':                           ['Elig',  'payer_id',                           'OK'],
  'CarrierId':                         ['Elig',  'rx_carrier',                         'OK'],
  'AccountId':                         ['Elig',  'rx_account',                         'OK'],
  'InsuranceGroupId':                  ['Grp',   'group_id',                           'OK'],
  'EligibilitySource':                 ['—',     'EXCL: ETL metadata only',            'EXCL'],
  'PlatformCode':                      [null,    null,                                 'WARN'],
  'LegacySystemSourceCustomerCoverageKey': [null, null,                                'WARN'],
  // Plan
  'PlanDescription':                   ['Elig',  'plan_name',                          'OK'],
  'AsoIndicator':                      ['BPkg',  'aso_indicator',                      'OK'],
  'LegacySystemSourceProdPlanKey':     [null,    null,                                 'WARN'],
  'SellingLedger':                     [null,    null,                                 'WARN'],
  'FormularyName':                     ['Elig',  'formulary_id',                       'OK'],
  // Product
  'ProductKey':                        [null,    null,                                 'WARN'],
  'PharmacyGroupId':                   ['Elig',  'rx_group',                           'OK'],
  'SpanType':                          [null,    null,                                 'WARN'],
  'ProductType':                       ['BPkg',  'product_type',                       'OK'],
  'PBPID':                             ['Elig',  'medicare_part_c_pbp_number',         'OK'],
  'RiskArrangement':                   [null,    null,                                 'WARN'],
  'ExchangeIdentifier':                [null,    null,                                 'WARN'],
  'SpecialtyIndicator':                [null,    null,                                 'WARN'],
  'ProductOfferCode':                  [null,    null,                                 'WARN'],
  'ProductLine':                       [null,    null,                                 'WARN'],
  // Coverage
  'RelationshipCode':                  ['Elig',  'relationship_code',                  'OK'],
  'CoverageTypeCode':                  [null,    null,                                 'WARN'],
  'CoverageStart':                     ['Elig',  'coverage_start_date',                'OK'],
  'CoverageEnd':                       ['Elig',  'coverage_end_date',                  'OK'],
  // Benefits
  'MemberBenefit':                     ['BPkg',  'medical_benefit_indicator + rx_benefit_indicator', 'WARN'],
  'HasOutOfNetworkBenefit':            ['BPkg',  'out_of_network_benefit_indicator',   'OK'],
  'IsRxCarvedOut':                     ['BPkg',  'rx_benefit_carve_out_indicator',     'OK'],
  'RxCarveOutStartDate':               ['BPkg',  'rx_benefit_carve_out_start_date',    'OK'],
  'RxCarveOutEndDate':                 ['BPkg',  'rx_benefit_carve_out_end_date',      'OK'],
  'RiskPatient':                       ['BPkg',  'is_medicare_advantage_risk_patient', 'OK'],
  'DualEligibilityStatus':             ['BPkg',  'dual_eligibility_indicator',         'OK'],
  'IsErisa':                           ['BPkg',  'is_erisa',                           'OK'],
  'IsFehbPlan':                        ['BPkg',  'is_fehb_plan',                       'OK'],
  // LOB
  'MajorLineOfBusiness':               ['BPkg',  'major_lob',                          'OK'],
  'AccessibilityPreference':           ['Elig',  'letter_accommodation_code',          'OK'],
  // Network
  'StateOfPlanIssue':                  ['Elig',  'state_of_issue',                     'OK'],
  'IsOutOfArea':                       ['BPkg',  'out_of_area_benefit_indicator',      'OK'],
  'OutOfAreaCategory':                 [null,    null,                                 'WARN'],
  'LeasedNetworkCode':                 [null,    null,                                 'WARN'],
  'ServiceFundPCPCenterLedger':        [null,    null,                                 'WARN'],
  'ConsolidatedMarketNumber':          [null,    null,                                 'WARN'],
  'RadiologyMktName':                  [null,    null,                                 'WARN'],
  'PCPGrouperNumber':                  [null,    null,                                 'WARN'],
  'PsychCode':                         [null,    null,                                 'WARN'],
  'CountyCode':                        [null,    null,                                 'WARN'],
  'ServFundLOBCode':                   [null,    null,                                 'WARN'],
  // Group
  'EmployerGroupKey':                  ['Elig',  'group_key',                          'OK'],
  'EmployerGroupAddressKey':           ['—',     'EXCL: addr not in feed',             'EXCL'],
  'ContractNumber':                    ['Elig',  'medicare_part_c_contract_number',    'OK'],
  'EmployerGroupName':                 ['Grp',   'group_name',                         'OK'],
  'ContractEffectiveDate':             ['Grp',   'contract_start_date',                'OK'],
  'ContractTerminationDate':           ['Grp',   'contract_end_date',                  'OK'],
  'ActionIndicator':                   [null,    null,                                 'WARN'],
  // Financial
  'FinProdCode':                       [null,    null,                                 'WARN'],
  'FinSubCode':                        [null,    null,                                 'WARN'],
  'LegalEntity':                       [null,    null,                                 'WARN'],
  'Division':                          [null,    null,                                 'WARN'],
  // PCP
  'PCPName':                           [null,    null,                                 'WARN'],
  'PCPID':                             [null,    null,                                 'WARN'],
  'PCPEffectiveDate':                  [null,    null,                                 'WARN'],
  // Representative
  'HasRepresentative':                 [null,    null,                                 'WARN'],
  'RepresentativeFirstName':           ['RelP',  'first_name',                         'OK'],
  'RepresentativeLastName':            ['RelP',  'last_name',                          'OK'],
  'RepresentativeAddressLine1':        ['Addr',  'address_line_1',                     'OK'],
  'RepresentativeAddressLine2':        ['Addr',  'address_line_2',                     'OK'],
  'RepresentativeCity':                ['Addr',  'city',                               'OK'],
  'RepresentativeState':               ['Addr',  'state',                              'OK'],
  'RepresentativeZipCode':             ['Addr',  'zip_code',                           'OK'],
  'RepresentativeZipPlusCode':         ['Addr',  'zip_extension',                      'OK'],
  'RepresentativeRelationshipCodeID':  ['RelP',  'relationship_code',                  'OK'],
  'RepresentativeHomePhone':           ['RelP',  'phone_1_number',                     'OK'],
  'RepresentativeWorkPhone':           ['RelP',  'phone_2_number',                     'OK'],
  'RepresentativeWorkPhoneExtension':  ['RelP',  'phone_2_extension',                  'OK'],
  // Audit
  'Checksum':                          [null,    null,                                 'WARN'],
  'HashValue':                         [null,    null,                                 'WARN'],
};

// Silver table badge colors
const S_TABLE_C = {
  'Elig': '#1565c0',
  'BPkg': '#4527a0',
  'Grp':  '#00695c',
  'RelP': '#6d4c41',
  'Addr': '#37474f',
  '—':    '#757575',
};

// -- Layout ------------------------------------------------------------------
const W       = 1060;
const ROW_H   = 34;
const TITLE_H = 76;
const HDR_H   = 28;
const FONT    = "Consolas, 'Courier New', monospace";
const C1W     = 32;
const C2W     = 220;
const C3W     = 110;
const C4W     = 280;  // Silver column

// -- Colors ------------------------------------------------------------------
const C = {
  title_bg:  '#1a237e',
  title_t:   '#e8eaf6',
  title_sub: '#9fa8da',
  hdr_bg:    '#283593',
  hdr_t:     '#e8eaf6',
  pk_bg:     '#fff9c4',
  pk_t:      '#f57f17',
  fk_bg:     '#e3f2fd',
  fk_t:      '#1565c0',
  keep_bg:   '#f9fbe7',
  keep_t:    '#212121',
  add_bg:    '#fff3e0',
  add_t:     '#e65100',
  review_bg: '#f3e5f5',
  review_t:  '#6a1b9a',
  reorder_bg:'#fffde7',
  reorder_t: '#b45309',
  type_t:    '#546e7a',
  note_t:    '#78909c',
  grp_bg:    '#ede7f6',
  grp_t:     '#4527a0',
  border:    '#9fa8da',
  divider:   '#c5cae9',
};

// -- Build row list ----------------------------------------------------------
const rows = [];
let lastGroup = null;
for (const [key, name, type, group, status, note] of COLUMNS) {
  if (group !== lastGroup) {
    rows.push({ kind: 'group', label: group });
    lastGroup = group;
  }
  rows.push({ kind: 'data', key, name, type, status, note });
}

const TOTAL_H = TITLE_H + HDR_H + rows.length * ROW_H;
const DATA_Y0 = TITLE_H + HDR_H;

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const L   = (x1,y1,x2,y2,stroke,w=0.5) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}"/>`;

const X2 = C1W;
const X3 = C1W + C2W;
const X4 = C1W + C2W + C3W;
const X5 = C1W + C2W + C3W + C4W;

const keeps    = COLUMNS.filter(c => c[4] === 'KEEP').length;
const fks      = COLUMNS.filter(c => c[4] === 'FK').length;
const adds     = COLUMNS.filter(c => c[4] === 'ADD').length;
const reviews  = COLUMNS.filter(c => c[4] === 'REVIEW').length;
const reorders = COLUMNS.filter(c => c[4] === 'REORDER').length;

const sWarn  = Object.values(SILVER).filter(s => s[2] === 'WARN').length;
const sExcl  = Object.values(SILVER).filter(s => s[2] === 'EXCL').length;

// -- SVG ---------------------------------------------------------------------
const lines = [
`<?xml version="1.0" encoding="UTF-8"?>`,
`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL_H}"`,
`     viewBox="0 0 ${W} ${TOTAL_H}" font-family="${FONT}" font-size="12">`,
`<defs><style>`,
`  text { dominant-baseline:middle; }`,
`  .keep   { fill:${C.keep_t}; }`,
`  .fk     { fill:${C.fk_t};      font-size:10px; font-weight:700; }`,
`  .add    { fill:${C.add_t};     font-weight:600; }`,
`  .rev    { fill:${C.review_t};  font-style:italic; }`,
`  .reorder{ fill:${C.reorder_t}; font-weight:700; }`,
`  .typ    { fill:${C.type_t};    font-size:11px; font-style:italic; }`,
`  .nt     { fill:${C.note_t};    font-size:10px; }`,
`  .pk     { fill:${C.pk_t};      font-size:10px; font-weight:700; }`,
`  .grp    { fill:${C.grp_t};     font-size:11px; font-weight:600; letter-spacing:.3px; }`,
`  .sc     { font-size:10px; fill:#37474f; }`,
`</style></defs>`,
`<rect x="0" y="0" width="${W}" height="${TOTAL_H}" rx="8" fill="${C.keep_bg}" stroke="${C.border}" stroke-width="1.5"/>`,
`<path d="M8,0 h${W-16} a8,8 0 0,1 8,8 v${TITLE_H-8} h-${W} v-${TITLE_H-8} a8,8 0 0,1 8,-8 z" fill="${C.title_bg}"/>`,
`<text x="14" y="22" style="font-size:14px;font-weight:700;fill:${C.title_t};">EligibilityFlat - UPDATED 2026-04-21 (${COLUMNS.length} cols, synced from Miro)</text>`,
`<text x="14" y="40" style="font-size:10px;fill:${C.title_sub};">Source: case domain svg.txt (Miro export)  |  Silver: Eligibility / BenefitPackage / Group / RelatedPerson / Address</text>`,
`<text x="14" y="58" style="font-size:10px;fill:${C.title_sub};">KEEP=${keeps}  FK=${fks}  REVIEW=${reviews}  |  Silver: OK=${COLUMNS.length - sWarn - sExcl}  WARN=${sWarn}  EXCL=${sExcl}</text>`,
`<rect x="0" y="${TITLE_H}" width="${W}" height="${HDR_H}" fill="${C.hdr_bg}"/>`,
`<text x="8"       y="${TITLE_H+HDR_H/2}" style="font-size:11px;font-weight:700;fill:${C.hdr_t};">Key</text>`,
`<text x="${X2+8}" y="${TITLE_H+HDR_H/2}" style="font-size:11px;font-weight:700;fill:${C.hdr_t};">Column Name</text>`,
`<text x="${X3+8}" y="${TITLE_H+HDR_H/2}" style="font-size:11px;font-weight:700;fill:${C.hdr_t};">Type</text>`,
`<text x="${X4+8}" y="${TITLE_H+HDR_H/2}" style="font-size:11px;font-weight:700;fill:${C.hdr_t};">Silver / Databricks</text>`,
`<text x="${X5+8}" y="${TITLE_H+HDR_H/2}" style="font-size:11px;font-weight:700;fill:${C.hdr_t};">Status / Notes</text>`,
L(X2, TITLE_H, X2, TITLE_H+HDR_H, C.border, 1),
L(X3, TITLE_H, X3, TITLE_H+HDR_H, C.border, 1),
L(X4, TITLE_H, X4, TITLE_H+HDR_H, C.border, 1),
L(X5, TITLE_H, X5, TITLE_H+HDR_H, C.border, 1),
L(0,  TITLE_H+HDR_H, W, TITLE_H+HDR_H, C.divider, 1.5),
];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const y   = DATA_Y0 + i * ROW_H;
  const mid = y + ROW_H / 2;

  if (row.kind === 'group') {
    lines.push(
      `<rect x="1" y="${y}" width="${W-2}" height="${ROW_H}" fill="${C.grp_bg}"/>`,
      `<text x="${X2+8}" y="${mid}" class="grp">-- ${esc(row.label.toUpperCase())} --</text>`,
      L(0, y+ROW_H, W, y+ROW_H, C.divider, 0.5),
    );
  } else {
    const { key, name, type, status, note } = row;

    const bg = key === 'PK'           ? C.pk_bg
             : status === 'FK'        ? C.fk_bg
             : status === 'ADD'       ? C.add_bg
             : status === 'REVIEW'    ? C.review_bg
             : status === 'REORDER'   ? C.reorder_bg
             : C.keep_bg;

    const ncls = status === 'ADD'     ? 'add'
               : status === 'REVIEW'  ? 'rev'
               : status === 'FK'      ? 'fk'
               : status === 'REORDER' ? 'reorder'
               : 'keep';

    const badgeColor = status === 'ADD'     ? '#e65100'
                     : status === 'REVIEW'  ? '#6a1b9a'
                     : status === 'FK'      ? '#1565c0'
                     : status === 'REORDER' ? '#b45309'
                     : '#388e3c';

    lines.push(`<rect x="1" y="${y}" width="${W-2}" height="${ROW_H}" fill="${bg}"/>`);

    if (key === 'PK') {
      lines.push(`<text x="8" y="${mid}" class="pk">PK</text>`);
    } else if (key === 'FK') {
      lines.push(`<text x="8" y="${mid}" class="fk">FK</text>`);
    }

    lines.push(`<text x="${X2+8}" y="${mid}" class="${ncls}">${esc(name)}</text>`);
    lines.push(`<text x="${X3+8}" y="${mid}" class="typ">${esc(type)}</text>`);

    // -- Silver column -------------------------------------------------------
    const sv = SILVER[name];
    if (sv) {
      const [tbl, col, ss] = sv;
      if (ss === 'OK' && tbl) {
        const tblColor = S_TABLE_C[tbl] || '#607d8b';
        const tblW = tbl.length * 7 + 8;
        lines.push(
          `<rect x="${X4+8}" y="${mid-9}" width="${tblW}" height="18" rx="3" fill="${tblColor}"/>`,
          `<text x="${X4+8+tblW/2}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">${esc(tbl)}</text>`,
          `<text x="${X4+14+tblW}" y="${mid}" class="sc">${esc(col)}</text>`,
        );
      } else if (ss === 'WARN') {
        const wLabel = col ? `${tbl ? tbl+'/' : ''}${col}` : '? not mapped';
        lines.push(
          `<rect x="${X4+8}" y="${mid-9}" width="30" height="18" rx="3" fill="#e65100"/>`,
          `<text x="${X4+23}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">WARN</text>`,
          `<text x="${X4+44}" y="${mid}" class="sc" style="fill:#b71c1c;">${esc(wLabel)}</text>`,
        );
      } else if (ss === 'EXCL') {
        const eLabel = col || 'excluded';
        lines.push(
          `<rect x="${X4+8}" y="${mid-9}" width="28" height="18" rx="3" fill="#f57f17"/>`,
          `<text x="${X4+22}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">EXCL</text>`,
          `<text x="${X4+42}" y="${mid}" class="sc" style="fill:#bf360c;">${esc(eLabel)}</text>`,
        );
      } else if (ss === 'NEW' && tbl) {
        const tblColor = S_TABLE_C[tbl] || '#607d8b';
        const tblW = tbl.length * 7 + 8;
        lines.push(
          `<rect x="${X4+8}" y="${mid-9}" width="${tblW}" height="18" rx="3" fill="${tblColor}"/>`,
          `<text x="${X4+8+tblW/2}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">${esc(tbl)}</text>`,
          `<rect x="${X4+14+tblW}" y="${mid-9}" width="28" height="18" rx="3" fill="#388e3c"/>`,
          `<text x="${X4+28+tblW}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">NEW</text>`,
          `<text x="${X4+48+tblW}" y="${mid}" class="sc">${esc(col)}</text>`,
        );
      }
    }

    // -- Status badge + Notes ------------------------------------------------
    const badgeLabel = status;
    const badgeW     = badgeLabel.length * 7 + 10;
    lines.push(
      `<rect x="${X5+8}" y="${mid-9}" width="${badgeW}" height="18" rx="3" fill="${badgeColor}"/>`,
      `<text x="${X5+8+badgeW/2}" y="${mid}" style="fill:#fff;font-size:9px;font-weight:700;text-anchor:middle;">${badgeLabel}</text>`,
      `<text x="${X5+16+badgeW}" y="${mid}" class="nt">${esc(note)}</text>`,
    );

    lines.push(
      L(X2, y, X2, y+ROW_H, C.divider),
      L(X3, y, X3, y+ROW_H, C.divider),
      L(X4, y, X4, y+ROW_H, C.divider),
      L(X5, y, X5, y+ROW_H, C.divider),
      L(0,  y+ROW_H, W, y+ROW_H, C.divider),
    );
  }
}

lines.push('</svg>');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

const groupCount = rows.filter(r => r.kind === 'group').length;
console.log(`Written: ${OUT}`);
console.log(`Size: ${W} x ${TOTAL_H}px`);
console.log(`Rows: ${rows.length} (${COLUMNS.length} cols + ${groupCount} group headers)`);
console.log(`KEEP=${keeps}  FK=${fks}  ADD=${adds}  REVIEW=${reviews}  REORDER=${reorders}  TOTAL=${COLUMNS.length}`);
console.log(`Silver: OK=${COLUMNS.length - sWarn - sExcl}  WARN=${sWarn}  EXCL=${sExcl}`);
