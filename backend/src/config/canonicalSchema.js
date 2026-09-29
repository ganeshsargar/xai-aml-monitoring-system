/**
 * Canonical Transaction Schema for FundTraceAI
 * Defines the standard fields required by downstream AML processing, scoring, and graph analytics.
 */

const CANONICAL_SCHEMA = {
  // ==========================================
  // REQUIRED FIELDS
  // ==========================================
  transaction_id: {
    field: 'transaction_id',
    display_label: 'Transaction ID',
    description: 'Unique identifier for the financial transaction',
    expected_type: 'string',
    required: true,
    synonyms: [
      'transaction_id', 'txn_id', 'tx_id', 'trans_id', 'transactionid',
      'reference_no', 'ref_no', 'tran_id', 'txid', 'utr', 'payment_id',
      'txn_ref', 'transaction_reference', 'id', 'trans_reference', 'txn_ref_no'
    ]
  },
  timestamp: {
    field: 'timestamp',
    display_label: 'Timestamp / Date',
    description: 'Date and time when the transaction took place',
    expected_type: 'date',
    required: true,
    synonyms: [
      'timestamp', 'date', 'txn_date', 'posting_date', 'datetime',
      'trans_date', 'transaction_date', 'tx_time', 'time', 'value_date',
      'created_at', 'booking_date', 'txn_dt', 'tx_dt', 'transaction_time',
      'val_date', 'txndate', 'post_date'
    ]
  },
  sender_account: {
    field: 'sender_account',
    display_label: 'Sender Account',
    description: 'Originating bank account or source wallet identifier',
    expected_type: 'string',
    required: true,
    synonyms: [
      'sender_account', 'from_account', 'debit_acc', 'source_account',
      'sender', 'sender_acc', 'from_acc', 'debtor_account', 'remitter_account',
      'orig_acc', 'sender_account_no', 'debit_account_no', 'source_acc',
      'debit_a_c_no', 'from_account_no', 'payer_account', 'debtor_acc',
      'payer_acc', 'debit_acc_no', 'sender_acc_no'
    ]
  },
  receiver_account: {
    field: 'receiver_account',
    display_label: 'Receiver Account',
    description: 'Destination account or beneficiary wallet identifier',
    expected_type: 'string',
    required: true,
    synonyms: [
      'receiver_account', 'to_account', 'credit_acc', 'destination_account',
      'receiver', 'receiver_acc', 'to_acc', 'beneficiary_account',
      'payee_account', 'dest_acc', 'creditor_account', 'receiver_account_no',
      'credit_account_no', 'dest_account', 'credit_a_c_no', 'to_account_no',
      'beneficiary_acc', 'creditor_acc', 'payee_acc', 'credit_acc_no',
      'receiver_acc_no', 'beneficiary_account_no'
    ]
  },
  amount: {
    field: 'amount',
    display_label: 'Amount',
    description: 'Monetary value of the transaction',
    expected_type: 'number',
    required: true,
    synonyms: [
      'amount', 'amt', 'txn_amount', 'value', 'transaction_amount',
      'transfer_amount', 'sum', 'volume', 'debit_amount', 'credit_amount',
      'amt_inr', 'txn_amt', 'amount_inr', 'val', 'transaction_value',
      'payment_amount', 'trans_amount', 'tx_amount'
    ]
  },
  currency: {
    field: 'currency',
    display_label: 'Currency',
    description: 'ISO 4217 three-letter currency code (e.g. INR, USD)',
    expected_type: 'string',
    required: true,
    synonyms: [
      'currency', 'curr', 'ccy', 'txn_currency', 'currency_code',
      'iso_currency', 'cur', 'txn_curr'
    ]
  },

  // ==========================================
  // OPTIONAL FIELDS
  // ==========================================
  sender_name: {
    field: 'sender_name',
    display_label: 'Sender Name',
    description: 'Name of originating individual or entity',
    expected_type: 'string',
    required: false,
    synonyms: [
      'sender_name', 'from_name', 'remitter_name', 'debtor_name',
      'source_name', 'payer_name', 'originator_name', 'sender_full_name',
      'remitter', 'payer', 'originator', 'debtor'
    ]
  },
  receiver_name: {
    field: 'receiver_name',
    display_label: 'Receiver Name',
    description: 'Name of destination individual or entity',
    expected_type: 'string',
    required: false,
    synonyms: [
      'receiver_name', 'to_name', 'beneficiary_name', 'creditor_name',
      'dest_name', 'payee_name', 'recipient_name', 'beneficiary',
      'payee', 'creditor', 'recipient'
    ]
  },
  country: {
    field: 'country',
    display_label: 'Country',
    description: 'Country or geographic jurisdiction code (e.g. IN, US, KY)',
    expected_type: 'string',
    required: false,
    synonyms: [
      'country', 'country_code', 'jurisdiction', 'geo_country',
      'nation', 'origin_country', 'dest_country', 'cntry', 'iso_country',
      'txn_country'
    ]
  },
  city: {
    field: 'city',
    display_label: 'City',
    description: 'City or metropolitan location of transaction',
    expected_type: 'string',
    required: false,
    synonyms: [
      'city', 'location_city', 'town', 'municipality', 'metro',
      'origin_city', 'branch_city', 'location'
    ]
  },
  device_id: {
    field: 'device_id',
    display_label: 'Device ID',
    description: 'Unique device identifier or terminal fingerprint',
    expected_type: 'string',
    required: false,
    synonyms: [
      'device_id', 'device_fingerprint', 'hardware_id', 'client_device',
      'imei', 'mac_address', 'device', 'terminal_id', 'machine_id'
    ]
  },
  ip_address: {
    field: 'ip_address',
    display_label: 'IP Address',
    description: 'Network IP address from which transaction was initiated',
    expected_type: 'string',
    required: false,
    synonyms: [
      'ip_address', 'ip', 'client_ip', 'ip_addr', 'source_ip',
      'remote_ip', 'host_ip', 'ipv4', 'ipv6'
    ]
  },
  payment_method: {
    field: 'payment_method',
    display_label: 'Payment Method',
    description: 'Payment channel or rail (e.g. UPI, RTGS, IMPS, NEFT, Cash Deposit)',
    expected_type: 'string',
    required: false,
    synonyms: [
      'payment_method', 'method', 'channel', 'payment_type', 'txn_type',
      'transfer_type', 'rail', 'payment_mode', 'mode', 'payment_channel',
      'instrument', 'pay_mode'
    ]
  },
  category: {
    field: 'category',
    display_label: 'Category',
    description: 'Transaction category classification (e.g. Transfer, Salary, Bill)',
    expected_type: 'string',
    required: false,
    synonyms: [
      'category', 'txn_category', 'classification', 'type', 'purpose',
      'transaction_type', 'category_code', 'txn_purpose', 'trans_type'
    ]
  },
  merchant: {
    field: 'merchant',
    display_label: 'Merchant',
    description: 'Commercial vendor or merchant name',
    expected_type: 'string',
    required: false,
    synonyms: [
      'merchant', 'merchant_name', 'vendor', 'payee_merchant',
      'business_name', 'shop', 'retailer', 'counterparty'
    ]
  },
  status: {
    field: 'status',
    display_label: 'Status',
    description: 'Execution or clearing status (e.g. Approved, Pending, Settled)',
    expected_type: 'string',
    required: false,
    synonyms: [
      'status', 'txn_status', 'state', 'execution_status',
      'result', 'clearing_status', 'settlement_status'
    ]
  }
};

const REQUIRED_FIELDS = Object.keys(CANONICAL_SCHEMA).filter(
  key => CANONICAL_SCHEMA[key].required
);

const OPTIONAL_FIELDS = Object.keys(CANONICAL_SCHEMA).filter(
  key => !CANONICAL_SCHEMA[key].required
);

module.exports = {
  CANONICAL_SCHEMA,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS
};
