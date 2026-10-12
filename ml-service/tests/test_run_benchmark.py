"""
Unit tests for run_benchmark.py header validation, adapter mapping, and failure cases.
"""

import os
import sys
import pytest
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from run_benchmark import (
    validate_column_mapping,
    IBM_REQUIRED_HEADERS,
    SAMLD_REQUIRED_HEADERS,
    generate_mock_benchmark_data,
    inspect_csv_headers,
)


def test_ibm_aml_header_validation_success():
    """Verifies that authentic IBM AML headers pass validation."""
    real_ibm_headers = [
        'Timestamp', 'From Bank', 'Account', 'To Bank', 'Account.1',
        'Amount Received', 'Receiving Currency', 'Amount Paid',
        'Payment Currency', 'Payment Format', 'Is Laundering'
    ]
    mapping = validate_column_mapping(real_ibm_headers, IBM_REQUIRED_HEADERS, "IBM-AML")
    assert mapping['timestamp'] == 'Timestamp'
    assert mapping['sender'] == 'Account'
    assert mapping['receiver'] == 'Account.1'
    assert mapping['amount'] == 'Amount Paid'
    assert mapping['label'] == 'Is Laundering'


def test_ibm_aml_header_validation_missing_sender_fails():
    """Verifies that missing critical header raises ValueError with descriptive message."""
    invalid_headers = [
        'Timestamp', 'From Bank', 'UnknownCol', 'To Bank', 'Account.1',
        'Amount Paid', 'Is Laundering'
    ]
    with pytest.raises(ValueError, match="Header validation failed"):
        validate_column_mapping(invalid_headers, IBM_REQUIRED_HEADERS, "IBM-AML")


def test_saml_d_header_validation_success():
    """Verifies that authentic SAML-D headers pass validation."""
    real_samld_headers = [
        'Time', 'Date', 'Sender_Account', 'Receiver_Account', 'Amount',
        'Payment_currency', 'Received_currency', 'Sender_bank_location',
        'Receiver_bank_location', 'Payment_type', 'Is_laundering', 'Laundering_type'
    ]
    mapping = validate_column_mapping(real_samld_headers, SAMLD_REQUIRED_HEADERS, "SAML-D")
    assert mapping['sender'] == 'Sender_Account'
    assert mapping['receiver'] == 'Receiver_Account'
    assert mapping['amount'] == 'Amount'
    assert mapping['label'] == 'Is_laundering'


def test_saml_d_header_validation_missing_label_fails():
    """Verifies that missing label column raises ValueError."""
    invalid_headers = [
        'Time', 'Sender_Account', 'Receiver_Account', 'Amount'
    ]
    with pytest.raises(ValueError, match="Header validation failed"):
        validate_column_mapping(invalid_headers, SAMLD_REQUIRED_HEADERS, "SAML-D")


def test_mock_benchmark_data_generation_and_header_check(tmp_path):
    """Verifies that mock generator creates authentic files that inspect and validate perfectly."""
    ibm_dir = str(tmp_path / "ibm")
    saml_dir = str(tmp_path / "saml")

    ibm_file = generate_mock_benchmark_data(ibm_dir, 'ibm_aml', n_rows=100)
    ibm_headers = inspect_csv_headers(ibm_file)
    ibm_mapping = validate_column_mapping(ibm_headers, IBM_REQUIRED_HEADERS, "IBM-AML")
    assert 'label' in ibm_mapping

    saml_file = generate_mock_benchmark_data(saml_dir, 'saml_d', n_rows=100)
    saml_headers = inspect_csv_headers(saml_file)
    saml_mapping = validate_column_mapping(saml_headers, SAMLD_REQUIRED_HEADERS, "SAML-D")
    assert 'label' in saml_mapping
