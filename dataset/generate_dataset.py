"""
Synthetic AML transaction dataset generator — FundTraceAI v2.

Design Notes:
- Realistic INR amounts: retail ₹500–₹80,000; suspicious ₹75K–₹25,00,000
- Real Indian customer names, city names, merchant names
- Configurable laundering rate (--laundering-rate, supports 0.003 to 0.08, default 0.01)
  with dynamic proportional scaling across 5 AML typologies:
  1. Structuring / Smurfing (splitting below CTR threshold)
  2. Layering / Multi-hop chains
  3. Circular loops (A -> B -> C -> A)
  4. Offshore / High-risk jurisdiction routing
  5. Rapid velocity bursts
- Optional label noise (--label-noise) to inject historical compliance miss-rate & false flags.
- Customer profile master table export (customers.csv).
"""

import os
import sys
import random
import argparse
from datetime import datetime, timedelta
import pandas as pd
import numpy as np

# Ensure ml-service is in sys.path to access shared risk_config
ml_service_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ml-service')
if ml_service_dir not in sys.path:
    sys.path.insert(0, ml_service_dir)

from risk_config import (
    get_high_risk_countries,
    get_high_risk_payment_methods,
    get_structuring_bounds,
    get_night_hours,
    get_ctr_threshold
)


# ─── Realistic Master Data ────────────────────────────────────────────────────

INDIAN_FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Arjun", "Sai", "Reyansh", "Kabir", "Rohan",
    "Ishaan", "Neel", "Priya", "Ananya", "Divya", "Pooja", "Sneha", "Riya",
    "Kavya", "Meera", "Shreya", "Aditi", "Vikram", "Rahul", "Suresh", "Manoj",
    "Nikhil", "Kiran", "Deepak", "Rajesh", "Amit", "Sanjay", "Sunita", "Geeta",
    "Anjali", "Nisha", "Rekha", "Manisha", "Preeti", "Sonia", "Neha", "Renu",
    "Harshit", "Mohit", "Akash", "Gaurav", "Tushar", "Yash", "Pranav", "Kunal",
    "Sachin", "Hemant", "Lakshmi", "Parvati", "Sarita", "Usha", "Kamla", "Asha",
]

INDIAN_LAST_NAMES = [
    "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Shah", "Joshi",
    "Agarwal", "Mehta", "Bose", "Chopra", "Malhotra", "Kapoor", "Iyer",
    "Nair", "Reddy", "Rao", "Pillai", "Menon", "Desai", "Jain", "Bansal",
    "Saxena", "Trivedi", "Pandey", "Mishra", "Dubey", "Tiwari", "Srivastava",
    "Choudhary", "Yadav", "Bhatt", "Chauhan", "Thakur", "Rathore", "Sethi",
    "Bhatia", "Kohli", "Arora", "Garg", "Mittal", "Bajaj", "Khatri",
]

INDIAN_CITIES = [
    "Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune",
    "Ahmedabad", "Jaipur", "Surat", "Lucknow", "Kanpur", "Nagpur", "Indore",
    "Thane", "Bhopal", "Visakhapatnam", "Vadodara", "Coimbatore", "Agra",
    "Noida", "Gurgaon", "Chandigarh", "Patna", "Ranchi", "Kochi", "Bhubaneswar",
]

OFFSHORE_CITIES = {
    "KY": "George Town",
    "PA": "Panama City",
    "AE": "Dubai",
    "RU": "Moscow",
    "BS": "Nassau",
    "LU": "Luxembourg City",
}

RETAIL_MERCHANTS = [
    "Flipkart", "Amazon India", "Myntra", "Nykaa", "BigBasket", "Swiggy",
    "Zomato", "Meesho", "Snapdeal", "JioMart", "PharmEasy", "1mg",
    "BookMyShow", "MakeMyTrip", "Cleartrip", "OYO Rooms", "Reliance Digital",
    "Croma", "Spencer's Retail", "D-Mart", "More Supermarket", "IKEA India",
    "Lifestyle Stores", "Shoppers Stop", "Pantaloons", "Fabindia",
    "Tanishq Jewellers", "Kalyan Jewellers", "PC Jeweller",
    "HDFC Life Insurance", "LIC Premium", "Bajaj Allianz", "ICICI Prudential",
    "SBI Cards", "HDFC Credit", "Axis Bank EMI", "Kotak Securities",
    "Zerodha Kite", "Angel One", "Upstox", "Groww", "PayTM Money",
    "BYJU's", "Unacademy", "Physics Wallah", "Coursera India",
    "Apollo Hospitals", "Fortis Healthcare", "Max Healthcare",
    "Tata Power", "Adani Gas", "BESCOM", "MSEDCL", "BSNL",
    "Airtel Postpaid", "Vi Recharge", "Jio Fiber", "Tata Play",
]

SUSPICIOUS_MERCHANTS = [
    "Global Asset Holdings Ltd", "Pacific Rim Ventures", "Offshore Capital Corp",
    "Shell Solutions Pvt Ltd", "Nexus Trading LLC", "Phantom Consulting",
    "Cayman Wealth Management", "Panama Trust Fund", "Dubai Gold Exchange",
    "Nassau Brokerage Services", "Luxembourg Portfolio AG", "Moskovskiy Capital",
    "Internal Fund Transfer", "Corporate Services Group", "Legal Retainer Corp",
    "Consulting Services Intl", "Advisory Board Holdings", "Elite Investments",
]

PAYMENT_METHODS = ['UPI', 'Net Banking', 'IMPS', 'RTGS', 'NEFT', 'Credit Card',
                   'Debit Card', 'Crypto Transfer', 'Cash Deposit']
CATEGORIES = ['Retail', 'Transfer', 'Investment', 'Utilities', 'Entertainment',
               'Services', 'Real Estate', 'Healthcare', 'Education']

NORMAL_COUNTRIES = ['IN', 'US', 'GB', 'CA', 'DE', 'FR', 'JP', 'AU', 'SG', 'CH']

OCCUPATIONS = [
    "Salaried Executive", "Software Engineer", "Doctor", "Teacher",
    "Consultant", "Chartered Accountant", "Student", "Clerk", "Retired",
    "Retail Trader", "Civil Servant", "Freelancer"
]

BUSINESS_TYPES = [
    "Retail Store", "IT Services", "Import/Export", "Real Estate",
    "Logistics & Transport", "Wholesale Trading", "Consulting Firm",
    "Jewellery Merchant", "E-commerce Retailer", "Financial Advisory"
]

BUSINESS_NAME_PREFIXES = ["Apex", "Global", "Zenith", "Royal", "Sterling", "Nexus", "Matrix", "Vanguard", "Pinnacle", "Titan"]
BUSINESS_NAME_SUFFIXES = ["Enterprises", "Trading Co", "Solutions Pvt Ltd", "Logistics", "Ventures", "Holdings", "Exports", "Industries"]


# ─── Helper Functions ─────────────────────────────────────────────────────────

def rand_name():
    return f"{random.choice(INDIAN_FIRST_NAMES)} {random.choice(INDIAN_LAST_NAMES)}"


def rand_city(country):
    if country in OFFSHORE_CITIES:
        return OFFSHORE_CITIES[country]
    if country == 'IN':
        return random.choice(INDIAN_CITIES)
    cities = {
        'US': ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami'],
        'GB': ['London', 'Manchester', 'Birmingham', 'Leeds'],
        'CA': ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
        'DE': ['Berlin', 'Frankfurt', 'Hamburg', 'Munich'],
        'FR': ['Paris', 'Lyon', 'Marseille'],
        'JP': ['Tokyo', 'Osaka', 'Nagoya'],
        'AU': ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
        'SG': ['Singapore'],
        'CH': ['Zurich', 'Geneva', 'Basel'],
    }
    return random.choice(cities.get(country, ['City Center']))


def rand_hour_biased(night_prob):
    night_hours = list(get_night_hours())
    if random.random() < night_prob:
        return random.choice(night_hours)
    return random.choice([h for h in range(24) if h not in night_hours])


def make_tx_id(n):
    return f"TX{200000 + n}"


def validate_laundering_rate(val):
    try:
        f = float(val)
    except ValueError:
        raise argparse.ArgumentTypeError(f"Invalid float value: {val}")
    if f < 0.003 or f > 0.08:
        raise argparse.ArgumentTypeError(
            f"--laundering-rate must be between 0.003 (0.3%) and 0.08 (8.0%), got {f}"
        )
    return f


# ─── Main Generator ───────────────────────────────────────────────────────────

def generate_aml_data(num_records=15000, laundering_rate=0.01, label_noise=False, output_dir=None, seed=42):
    """
    Generates synthetic AML dataset scaled to target laundering rate and outputs
    both transactions (dataset.csv) and customer profiles (customers.csv).

    Parameters:
    -----------
    num_records : int
        Total number of transactions to generate (default 15,000).
    laundering_rate : float
        Proportion of transactions that belong to AML typologies (0.003 to 0.08, default 0.01).
    label_noise : bool
        If True, injects historical miss-rate (~4%) and false positive flags (~0.5%).
    output_dir : str, optional
        Target directory to save generated CSV files. Defaults to dataset/ directory.
    seed : int
        Random seed for reproducibility.
    """
    if laundering_rate < 0.003 or laundering_rate > 0.08:
        raise ValueError(f"laundering_rate must be between 0.003 and 0.08, got {laundering_rate}")

    np.random.seed(seed)
    random.seed(seed)

    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(output_dir, exist_ok=True)

    start_time = datetime(2025, 6, 1, 0, 0, 0)

    # ── 1. Generate Customer Profile Table & Linked Accounts ───────────────────
    num_customers = 800
    num_accounts = 1200
    customers = []
    accounts = []

    # Designate ~50 customers as suspicious/mule/smurf nodes whose transactions heavily deviate
    # from their declared profiles
    deviating_customer_indices = set(range(50))

    for c_idx in range(num_customers):
        cust_id = f"CUST{10000 + c_idx}"
        is_deviating = c_idx in deviating_customer_indices
        is_business = random.random() < 0.15

        if is_business:
            cust_type = 'business'
            biz_prefix = random.choice(BUSINESS_NAME_PREFIXES)
            biz_suffix = random.choice(BUSINESS_NAME_SUFFIXES)
            name = f"{biz_prefix} {biz_suffix}"
            biz_type = random.choice(BUSINESS_TYPES)

            if is_deviating:
                # Inactive/dormant shell company with low declared turnover
                declared_income = float(random.choice([40000, 60000, 80000, 100000]))
                kyc_risk = "High" if random.random() < 0.6 else "Med"
            else:
                declared_income = float(round(random.uniform(1500000, 20000000), 2))
                kyc_risk = random.choices(["Low", "Med", "High"], weights=[0.75, 0.20, 0.05])[0]

            pep = 0
            beneficial_owners = [f"BO_{rand_name().replace(' ', '_')}"]
        else:
            cust_type = 'individual'
            name = rand_name()

            if is_deviating:
                # Student, clerk, unemployed with very low declared income
                occ = random.choice(["Student", "Clerk", "Unemployed", "Driver", "Delivery Associate"])
                declared_income = float(random.choice([15000, 20000, 25000, 30000]))
                kyc_risk = "High" if random.random() < 0.5 else "Med"
                pep = 1 if random.random() < 0.05 else 0
            else:
                occ = random.choice(OCCUPATIONS)
                declared_income = float(round(random.uniform(35000, 300000), 2))
                pep = 1 if random.random() < 0.015 else 0
                kyc_risk = "High" if pep == 1 else random.choices(["Low", "Med", "High"], weights=[0.80, 0.17, 0.03])[0]

            biz_type = occ
            beneficial_owners = []

        onboarding_days_ago = random.randint(180, 1800)
        onboarding_dt = start_time - timedelta(days=onboarding_days_ago)
        country = 'IN' if random.random() < 0.96 else random.choice(NORMAL_COUNTRIES)
        city = random.choice(INDIAN_CITIES)
        flagged = 1 if (is_deviating and random.random() < 0.4) or kyc_risk == "High" else 0

        customers.append({
            'customer_id': cust_id,
            'name': name,
            'type': cust_type,
            'occupation_or_business_type': biz_type,
            'declared_monthly_income_or_turnover': declared_income,
            'kyc_risk_rating': kyc_risk,
            'is_pep': pep,
            'onboarding_date': onboarding_dt.strftime('%Y-%m-%d'),
            'country_of_residence': country,
            'beneficial_owner_ids': ",".join(beneficial_owners),
            # Backward-compatibility aliases for test_data_adapters
            'customer_name': name,
            'risk_tier': kyc_risk,
            'occupation': biz_type,
            'base_city': city,
            'is_previously_flagged': flagged,
            'kyc_status': 'Verified' if random.random() < 0.96 else 'Pending',
            'account_created_at': onboarding_dt.strftime('%Y-%m-%d')
        })

    # Distribute 1200 accounts
    account_lookup = {}
    for idx in range(num_customers):
        c = customers[idx]
        acc_no = f"ACC{20000 + idx}"
        prod_type = "business_current" if c['type'] == 'business' else random.choice(["savings", "current"])
        open_dt = datetime.strptime(c['onboarding_date'], '%Y-%m-%d') + timedelta(days=random.randint(0, 10))
        acc_entry = {
            'account_id': acc_no,
            'customer_id': c['customer_id'],
            'open_date': open_dt.strftime('%Y-%m-%d'),
            'product_type': prod_type,
            'acc_number': acc_no,
            'holder_name': c['name'],
            'is_previously_flagged': c['is_previously_flagged'],
            'base_city': c['base_city'],
            'customer': c
        }
        accounts.append(acc_entry)
        account_lookup[acc_no] = acc_entry
        c['account_number'] = acc_no

    multi_custs = [c for c in customers if c['type'] == 'business'] + [c for c in customers if c['type'] == 'individual'][:300]
    for idx in range(num_customers, num_accounts):
        acc_no = f"ACC{20000 + idx}"
        chosen_cust = random.choice(multi_custs)
        prod_type = "current" if chosen_cust['type'] == 'individual' else "business_current"
        open_dt = datetime.strptime(chosen_cust['onboarding_date'], '%Y-%m-%d') + timedelta(days=random.randint(10, 180))
        acc_entry = {
            'account_id': acc_no,
            'customer_id': chosen_cust['customer_id'],
            'open_date': open_dt.strftime('%Y-%m-%d'),
            'product_type': prod_type,
            'acc_number': acc_no,
            'holder_name': chosen_cust['name'],
            'is_previously_flagged': chosen_cust['is_previously_flagged'],
            'base_city': chosen_cust['base_city'],
            'customer': chosen_cust
        }
        accounts.append(acc_entry)
        account_lookup[acc_no] = acc_entry

    acc_numbers = [acc['acc_number'] for acc in accounts]
    deviating_accounts = [acc['acc_number'] for acc in accounts if int(acc['customer']['customer_id'][4:]) < 10050]
    normal_accounts = [acc['acc_number'] for acc in accounts if int(acc['customer']['customer_id'][4:]) >= 10050]

    devices = [f"DEV{random.randint(100000, 999999)}" for _ in range(800)]
    ips = [f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
           for _ in range(800)]

    def make_tx_record(sender, receiver, amount, timestamp, country, city, dev, ip, method, merchant, cat, status, is_laundering):
        s_acc = account_lookup[sender]
        r_acc = account_lookup[receiver]
        s_cust = s_acc['customer']
        r_cust = r_acc['customer']
        ts_str = timestamp.isoformat() if isinstance(timestamp, datetime) else str(timestamp)
        return {
            'sender_account': sender,
            'sender_name': s_acc['holder_name'],
            'receiver_account': receiver,
            'receiver_name': r_acc['holder_name'],
            'amount': round(float(amount), 2),
            'currency': 'INR',
            'timestamp': ts_str,
            'country': country,
            'city': city,
            'device_id': dev,
            'ip_address': ip,
            'payment_method': method,
            'merchant': merchant,
            'category': cat,
            'status': status,
            'is_laundering': int(is_laundering),
            'sender_customer_id': s_cust['customer_id'],
            'sender_customer_type': s_cust['type'],
            'sender_declared_income': s_cust['declared_monthly_income_or_turnover'],
            'sender_onboarding_date': s_cust['onboarding_date'],
            'sender_account_open_date': s_acc['open_date'],
            'receiver_customer_id': r_cust['customer_id'],
            'receiver_customer_type': r_cust['type'],
            'receiver_declared_income': r_cust['declared_monthly_income_or_turnover'],
            'receiver_onboarding_date': r_cust['onboarding_date'],
            'receiver_account_open_date': r_acc['open_date'],
        }

    # ── 2. Dynamic Typology Scaling from Laundering Rate ───────────────────────
    high_risk_countries = get_high_risk_countries()
    struct_lower, struct_upper = get_structuring_bounds()

    # Baseline typology expected volume for 15,000 transactions is ~1,157.5 (~7.72%).
    target_laundering = max(1, int(round(num_records * laundering_rate)))
    baseline_laundering_expected = 1157.5 * (num_records / 15000.0)
    scale = target_laundering / max(1.0, baseline_laundering_expected)

    num_structuring_groups = max(1, int(round(60 * scale * (num_records / 15000.0))))
    num_chains = max(1, int(round(55 * scale * (num_records / 15000.0))))
    num_loops = max(1, int(round(40 * scale * (num_records / 15000.0))))
    num_high_risk = max(1, int(round(180 * scale * (num_records / 15000.0))))
    num_bursts = max(1, int(round(30 * scale * (num_records / 15000.0))))

    laundering_data = []

    # ── Typology 1: Structuring / Smurfing — multiple splits below CTR limit ──
    for g in range(num_structuring_groups):
        # Receiver is a deviating mule/smurf account with low declared income
        receiver = random.choice(deviating_accounts)
        sender = random.choice(acc_numbers)
        while receiver == sender:
            sender = random.choice(acc_numbers)

        num_splits = random.randint(3, 7)
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=random.randint(0, 23))
        band_low = random.uniform(struct_lower, struct_lower + (struct_upper - struct_lower) * 0.7)
        band_high = min(band_low + random.uniform(10000, 30000), struct_upper)

        for s in range(num_splits):
            amount = round(random.uniform(band_low, band_high), 2)
            timestamp = base_time + timedelta(minutes=random.randint(10, 90) * s)
            pay_method = random.choice(['UPI', 'IMPS', 'Cash Deposit', 'NEFT'])
            laundering_data.append(make_tx_record(
                sender=sender,
                receiver=receiver,
                amount=amount,
                timestamp=timestamp,
                country='IN' if random.random() < 0.6 else random.choice(NORMAL_COUNTRIES),
                city=random.choice(INDIAN_CITIES),
                dev=random.choice(devices),
                ip=random.choice(ips),
                method=pay_method,
                merchant='Internal Transfer',
                cat=random.choice(['Transfer', 'Services']),
                status='Approved',
                is_laundering=1
            ))

    # ── Typology 2: Layering / Multi-Hop Chains ──────────────────────────────
    for c in range(num_chains):
        chain_len = random.randint(3, 6)
        chain_accounts = []
        while len(chain_accounts) < chain_len + 1:
            acc = random.choice(deviating_accounts if random.random() < 0.65 else acc_numbers)
            if acc not in chain_accounts:
                chain_accounts.append(acc)

        base_amount = round(random.uniform(500000, 2500000), 2)  # ₹5L – ₹25L
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=rand_hour_biased(0.45))
        skim_rate = random.uniform(0.88, 0.97)
        merchant = random.choice(SUSPICIOUS_MERCHANTS)

        for step in range(chain_len):
            sender = chain_accounts[step]
            receiver = chain_accounts[step + 1]
            amount = round(base_amount * (skim_rate ** step), 2)
            timestamp = base_time + timedelta(hours=random.randint(1, 8) * step)
            country = random.choice(high_risk_countries) if random.random() < 0.45 else random.choice(NORMAL_COUNTRIES)

            laundering_data.append(make_tx_record(
                sender=sender,
                receiver=receiver,
                amount=amount,
                timestamp=timestamp,
                country=country,
                city=rand_city(country),
                dev=random.choice(devices),
                ip=random.choice(ips),
                method=random.choice(['RTGS', 'IMPS', 'Crypto Transfer', 'Net Banking']),
                merchant=merchant,
                cat=random.choice(['Transfer', 'Investment', 'Services']),
                status='Approved',
                is_laundering=1
            ))

    # ── Typology 3: Circular Loops (A -> B -> C -> A) ────────────────────────
    for l in range(num_loops):
        loop_size = random.randint(3, 5)
        loop_accounts = []
        while len(loop_accounts) < loop_size:
            acc = random.choice(deviating_accounts if random.random() < 0.7 else acc_numbers)
            if acc not in loop_accounts:
                loop_accounts.append(acc)

        base_amount = round(random.uniform(750000, 5000000), 2)  # ₹7.5L – ₹50L
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=rand_hour_biased(0.35))

        for step in range(loop_size):
            sender = loop_accounts[step]
            receiver = loop_accounts[(step + 1) % loop_size]
            decay = random.uniform(0.87, 0.97)
            amount = round(base_amount * (decay ** step), 2)
            timestamp = base_time + timedelta(days=step, hours=random.randint(0, 4))
            country = random.choice(high_risk_countries) if random.random() < 0.5 else random.choice(NORMAL_COUNTRIES)
            merchant = random.choice(SUSPICIOUS_MERCHANTS)

            laundering_data.append(make_tx_record(
                sender=sender,
                receiver=receiver,
                amount=amount,
                timestamp=timestamp,
                country=country,
                city=rand_city(country),
                dev=random.choice(devices),
                ip=random.choice(ips),
                method=random.choice(['RTGS', 'IMPS', 'Crypto Transfer']),
                merchant=merchant,
                cat=random.choice(['Transfer', 'Investment', 'Services']),
                status='Approved',
                is_laundering=1
            ))

    # ── Typology 4: High-risk Jurisdiction / Flagged-Account Routing ─────────
    for h in range(num_high_risk):
        sender = random.choice(deviating_accounts)
        receiver = random.choice(acc_numbers)
        while receiver == sender:
            receiver = random.choice(acc_numbers)

        amount = round(random.uniform(250000, 2500000), 2)  # ₹2.5L – ₹25L
        ts = start_time + timedelta(days=random.randint(0, 180),
                                    hours=rand_hour_biased(0.40))
        country = random.choice(high_risk_countries)

        laundering_data.append(make_tx_record(
            sender=sender,
            receiver=receiver,
            amount=amount,
            timestamp=ts,
            country=country,
            city=rand_city(country),
            dev=random.choice(devices),
            ip=random.choice(ips),
            method=random.choice(['Crypto Transfer', 'RTGS', 'IMPS']),
            merchant=random.choice(SUSPICIOUS_MERCHANTS),
            cat=random.choice(['Investment', 'Transfer', 'Services']),
            status='Approved',
            is_laundering=1
        ))

    # ── Typology 5: Rapid Velocity Bursts ─────────────────────────────────────
    for b in range(num_bursts):
        sender = random.choice(deviating_accounts)
        burst_size = random.randint(6, 12)
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=rand_hour_biased(0.50))

        for tx in range(burst_size):
            receiver = random.choice(acc_numbers)
            while receiver == sender:
                receiver = random.choice(acc_numbers)
            amount = round(random.uniform(50000, 500000), 2)  # ₹50K – ₹5L each
            timestamp = base_time + timedelta(minutes=random.randint(1, 8) * tx)

            laundering_data.append(make_tx_record(
                sender=sender,
                receiver=receiver,
                amount=amount,
                timestamp=timestamp,
                country=random.choice(NORMAL_COUNTRIES + high_risk_countries),
                city=rand_city('IN'),
                dev=random.choice(devices),
                ip=random.choice(ips),
                method=random.choice(['IMPS', 'UPI', 'RTGS']),
                merchant=random.choice(SUSPICIOUS_MERCHANTS),
                cat='Transfer',
                status='Approved',
                is_laundering=1
            ))

    # If laundering generated exceeds or falls slightly short of target_laundering, trim or sample
    if len(laundering_data) > target_laundering:
        random.shuffle(laundering_data)
        laundering_data = laundering_data[:target_laundering]

    # ── 3. Legitimate Transactions ───────────────────────────────────────────
    num_normal = max(0, num_records - len(laundering_data))
    print(f"Generating {num_normal:,} legitimate transactions and {len(laundering_data):,} laundering transactions (target rate: {laundering_rate:.1%})...")

    legit_data = []
    for i in range(num_normal):
        sender = random.choice(normal_accounts)
        receiver = random.choice(acc_numbers)
        while receiver == sender:
            receiver = random.choice(acc_numbers)

        s_decl = account_lookup[sender]['customer']['declared_monthly_income_or_turnover']
        # Conforming legitimate amounts: typical transactions scale nicely with declared profile
        r = random.random()
        if r < 0.50:
            amount = round(float(np.random.exponential(scale=2500.0) + 500.0), 2)   # ₹500 – ₹15K typical
            amount = min(amount, min(15000.0, s_decl * 0.4))
            amount = max(amount, 250.0)
        elif r < 0.80:
            max_amt = min(45000.0, s_decl * 0.7)
            amount = round(random.uniform(1000, max(2000, max_amt)), 2)
        elif r < 0.93:
            max_amt = min(180000.0, s_decl * 1.1)
            amount = round(random.uniform(25000, max(30000, max_amt)), 2)
        elif r < 0.985:
            max_amt = min(800000.0, s_decl * 2.0)
            amount = round(random.uniform(100000, max(120000, max_amt)), 2)
        else:
            amount = round(random.uniform(8500, 9999), 2)

        country = 'IN' if random.random() < 0.72 else random.choice(NORMAL_COUNTRIES)
        if random.random() < 0.05:  # 5% noise — legit tx to high-risk country
            country = random.choice(high_risk_countries)

        day_offset = random.randint(0, 180)
        hour = rand_hour_biased(night_prob=0.10)
        timestamp = start_time + timedelta(days=day_offset, hours=hour,
                                           minutes=random.randint(0, 59))

        pay_method = random.choice(PAYMENT_METHODS)
        category = random.choice(CATEGORIES)
        merchant = random.choice(RETAIL_MERCHANTS)

        legit_data.append(make_tx_record(
            sender=sender,
            receiver=receiver,
            amount=amount,
            timestamp=timestamp,
            country=country,
            city=rand_city(country),
            dev=random.choice(devices),
            ip=random.choice(ips),
            method=pay_method,
            merchant=merchant,
            cat=category,
            status='Approved',
            is_laundering=0
        ))

    all_data = legit_data + laundering_data
    random.shuffle(all_data)

    # Assign final transaction IDs
    for idx, tx in enumerate(all_data):
        tx['transaction_id'] = make_tx_id(idx)

    df = pd.DataFrame(all_data)

    # ── 4. Label Noise (Optional via flag) ────────────────────────────────────
    if label_noise:
        print("[Label Noise] Injecting realistic historical miss-rate (~4%) and false flags (~0.5%)...")
        rng = np.random.default_rng(seed)
        laundering_idx = df.index[df['is_laundering'] == 1].tolist()
        clean_idx = df.index[df['is_laundering'] == 0].tolist()

        if laundering_idx:
            flip_clean = rng.choice(laundering_idx, size=max(1, int(0.04 * len(laundering_idx))), replace=False)
            df.loc[flip_clean, 'is_laundering'] = 0

        if clean_idx:
            flip_dirty = rng.choice(clean_idx, size=max(1, int(0.005 * len(clean_idx))), replace=False)
            df.loc[flip_dirty, 'is_laundering'] = 1
    else:
        print("[Label Noise] Disabled (ground truth labels preserved).")

    # Add amount_inr column (synthetic is INR 1:1)
    df['amount_inr'] = df['amount']

    # ── 5. Save Outputs ───────────────────────────────────────────────────────
    output_tx_path = os.path.join(output_dir, 'dataset.csv')
    df.to_csv(output_tx_path, index=False)

    customers_df = pd.DataFrame(customers)
    output_cust_path = os.path.join(output_dir, 'customers.csv')
    customers_df.to_csv(output_cust_path, index=False)

    accounts_df = pd.DataFrame([{
        'account_id': a['account_id'],
        'customer_id': a['customer_id'],
        'open_date': a['open_date'],
        'product_type': a['product_type']
    } for a in accounts])
    output_acc_path = os.path.join(output_dir, 'accounts.csv')
    accounts_df.to_csv(output_acc_path, index=False)

    total = len(df)
    fraud = int(df['is_laundering'].sum())
    print(f"\n[OK] Dataset saved to: {output_tx_path}")
    print(f"[OK] Customer profiles saved to: {output_cust_path}")
    print(f"[OK] Account mappings saved to: {output_acc_path}")
    print(f"   Total records     : {total:,}")
    print(f"   Laundering flags  : {fraud:,} ({fraud / total:.2%})")
    print(f"   Clean transactions: {total - fraud:,} ({(total - fraud) / total:.2%})")
    print(f"   Unique customers  : {len(customers_df):,}")

    return df


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Generate synthetic AML transaction & customer datasets.")
    parser.add_argument(
        '--num-transactions', '--num-records',
        dest='num_records',
        type=int,
        default=15000,
        help="Total number of transactions to generate (default: 15,000)"
    )
    parser.add_argument(
        '--laundering-rate',
        type=validate_laundering_rate,
        default=0.01,
        help="Proportion of laundering transactions (range 0.003 to 0.08, default: 0.01)"
    )
    parser.add_argument(
        '--label-noise',
        action='store_true',
        default=False,
        help="Enable realistic label noise (~4%% historical misses, ~0.5%% false positives)"
    )
    parser.add_argument(
        '--output-dir',
        type=str,
        default=None,
        help="Output directory path (default: dataset/ directory)"
    )
    parser.add_argument(
        '--seed',
        type=int,
        default=42,
        help="Random seed for reproducibility (default: 42)"
    )

    args = parser.parse_args()
    generate_aml_data(
        num_records=args.num_records,
        laundering_rate=args.laundering_rate,
        label_noise=args.label_noise,
        output_dir=args.output_dir,
        seed=args.seed
    )
