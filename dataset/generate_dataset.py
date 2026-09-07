"""
Synthetic AML transaction dataset generator — FundTraceAI v2.

Design Notes:
- Realistic INR amounts: retail ₹500–₹80,000; suspicious ₹75K–₹25,00,000
- Real Indian customer names, city names, merchant names
- Multiple laundering typologies: structuring, layering, circular loops,
  offshore routing, rapid velocity bursts
- Label noise injected (~4% miss-rate / 0.5% false-positive) to prevent
  ML models from achieving trivial 100% separability on the training set.
"""

import os
import random
import pandas as pd
import numpy as np
from datetime import datetime, timedelta


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

HIGH_RISK_COUNTRIES = ['KY', 'PA', 'AE', 'RU', 'BS', 'LU']
NORMAL_COUNTRIES = ['IN', 'US', 'GB', 'CA', 'DE', 'FR', 'JP', 'AU', 'SG', 'CH']


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
    night_hours = [22, 23, 0, 1, 2, 3, 4, 5]
    if random.random() < night_prob:
        return random.choice(night_hours)
    return random.choice([h for h in range(24) if h not in night_hours])


def make_tx_id(n):
    return f"TX{200000 + n}"


# ─── Main Generator ───────────────────────────────────────────────────────────

def generate_aml_data(num_records=15000, seed=42):
    np.random.seed(seed)
    random.seed(seed)

    num_accounts = 1200
    accounts = []
    for i in range(num_accounts):
        accounts.append({
            'acc_number': f"ACC{20000 + i}",
            'holder_name': rand_name(),
            'is_previously_flagged': 1 if random.random() < 0.025 else 0,
        })

    account_lookup = {acc['acc_number']: acc for acc in accounts}
    acc_numbers = [acc['acc_number'] for acc in accounts]
    devices = [f"DEV{random.randint(100000, 999999)}" for _ in range(800)]
    ips = [f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
           for _ in range(800)]

    start_time = datetime(2025, 6, 1, 0, 0, 0)
    data = []

    # ─── 1. Legitimate Transactions (~91%) ───────────────────────────────────
    num_normal = int(num_records * 0.91)
    print(f"Generating {num_normal} legitimate transactions (with realistic noise)...")

    for i in range(num_normal):
        sender = random.choice(acc_numbers)
        receiver = random.choice(acc_numbers)
        while receiver == sender:
            receiver = random.choice(acc_numbers)

        # Realistic INR distribution — exponential skewed towards small amounts
        r = random.random()
        if r < 0.50:
            amount = round(float(np.random.exponential(scale=2500.0) + 500.0), 2)   # ₹500 – ₹15K typical
            amount = min(amount, 15000.0)
        elif r < 0.80:
            amount = round(random.uniform(1000, 45000), 2)    # ₹1K – ₹45K mid-tier
        elif r < 0.93:
            amount = round(random.uniform(45000, 180000), 2)  # ₹45K – ₹1.8L larger retail/EMI
        elif r < 0.985:
            amount = round(random.uniform(180000, 800000), 2) # ₹1.8L – ₹8L investment/RE
        else:
            # A few legit near-threshold (realistic false-positive territory)
            amount = round(random.uniform(8500, 9999), 2)

        country = 'IN' if random.random() < 0.72 else random.choice(NORMAL_COUNTRIES)
        if random.random() < 0.05:  # 5% noise — legit tx to high-risk country
            country = random.choice(HIGH_RISK_COUNTRIES)

        day_offset = random.randint(0, 180)
        hour = rand_hour_biased(night_prob=0.10)
        timestamp = start_time + timedelta(days=day_offset, hours=hour,
                                           minutes=random.randint(0, 59))

        pay_method = random.choice(PAYMENT_METHODS)
        category = random.choice(CATEGORIES)
        merchant = random.choice(RETAIL_MERCHANTS)

        data.append({
            'transaction_id': make_tx_id(len(data)),
            'sender_account': sender,
            'sender_name': account_lookup[sender]['holder_name'],
            'receiver_account': receiver,
            'receiver_name': account_lookup[receiver]['holder_name'],
            'amount': amount,
            'currency': 'INR',
            'timestamp': timestamp.isoformat(),
            'country': country,
            'city': rand_city(country),
            'device_id': random.choice(devices),
            'ip_address': random.choice(ips),
            'payment_method': pay_method,
            'merchant': merchant,
            'category': category,
            'status': 'Approved',
            'is_laundering': 0
        })

    # ─── 2. Structuring / Smurfing — multiple splits below CTR limit ─────────
    print("Generating structuring / smurfing transactions...")
    num_structuring_groups = 60
    for g in range(num_structuring_groups):
        sender = random.choice(acc_numbers)
        receiver = random.choice(acc_numbers)
        while receiver == sender:
            receiver = random.choice(acc_numbers)

        num_splits = random.randint(3, 7)
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=random.randint(0, 23))
        # Amounts band structured just below ₹10,00,000 (Indian CTR limit)
        band_low = random.uniform(820000, 950000)
        band_high = min(band_low + random.uniform(30000, 49000), 999000)

        for s in range(num_splits):
            amount = round(random.uniform(band_low, band_high), 2)
            timestamp = base_time + timedelta(minutes=random.randint(10, 90) * s)
            pay_method = random.choice(['UPI', 'IMPS', 'Cash Deposit', 'NEFT'])
            data.append({
                'transaction_id': make_tx_id(len(data)),
                'sender_account': sender,
                'sender_name': account_lookup[sender]['holder_name'],
                'receiver_account': receiver,
                'receiver_name': account_lookup[receiver]['holder_name'],
                'amount': amount,
                'currency': 'INR',
                'timestamp': timestamp.isoformat(),
                'country': 'IN' if random.random() < 0.6 else random.choice(NORMAL_COUNTRIES),
                'city': random.choice(INDIAN_CITIES),
                'device_id': random.choice(devices),
                'ip_address': random.choice(ips),
                'payment_method': pay_method,
                'merchant': 'Internal Transfer',
                'category': random.choice(['Transfer', 'Services']),
                'status': 'Approved',
                'is_laundering': 1
            })

    # ─── 3. Layering / Chain Transactions ────────────────────────────────────
    print("Generating layering chain transactions...")
    num_chains = 55
    for c in range(num_chains):
        chain_len = random.randint(3, 6)
        chain_accounts = []
        while len(chain_accounts) < chain_len + 1:
            acc = random.choice(acc_numbers)
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
            country = random.choice(HIGH_RISK_COUNTRIES) if random.random() < 0.45 else random.choice(NORMAL_COUNTRIES)

            data.append({
                'transaction_id': make_tx_id(len(data)),
                'sender_account': sender,
                'sender_name': account_lookup[sender]['holder_name'],
                'receiver_account': receiver,
                'receiver_name': account_lookup[receiver]['holder_name'],
                'amount': amount,
                'currency': 'INR',
                'timestamp': timestamp.isoformat(),
                'country': country,
                'city': rand_city(country),
                'device_id': random.choice(devices),
                'ip_address': random.choice(ips),
                'payment_method': random.choice(['RTGS', 'IMPS', 'Crypto Transfer', 'Net Banking']),
                'merchant': merchant,
                'category': random.choice(['Transfer', 'Investment', 'Services']),
                'status': 'Approved',
                'is_laundering': 1
            })

    # ─── 4. Circular Loops (A→B→C→A) ────────────────────────────────────────
    print("Generating circular loop transactions...")
    num_loops = 40
    for l in range(num_loops):
        loop_size = random.randint(3, 5)
        loop_accounts = []
        while len(loop_accounts) < loop_size:
            acc = random.choice(acc_numbers)
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
            country = random.choice(HIGH_RISK_COUNTRIES) if random.random() < 0.5 else random.choice(NORMAL_COUNTRIES)
            merchant = random.choice(SUSPICIOUS_MERCHANTS)

            data.append({
                'transaction_id': make_tx_id(len(data)),
                'sender_account': sender,
                'sender_name': account_lookup[sender]['holder_name'],
                'receiver_account': receiver,
                'receiver_name': account_lookup[receiver]['holder_name'],
                'amount': amount,
                'currency': 'INR',
                'timestamp': timestamp.isoformat(),
                'country': country,
                'city': rand_city(country),
                'device_id': random.choice(devices),
                'ip_address': random.choice(ips),
                'payment_method': random.choice(['RTGS', 'IMPS', 'Crypto Transfer']),
                'merchant': merchant,
                'category': random.choice(['Transfer', 'Investment', 'Services']),
                'status': 'Approved',
                'is_laundering': 1
            })

    # ─── 5. High-risk Jurisdiction / Flagged-Account Routing ─────────────────
    print("Generating high-risk jurisdiction transactions...")
    flagged_senders = [acc['acc_number'] for acc in accounts if acc['is_previously_flagged'] == 1]
    num_high_risk = 180
    for h in range(num_high_risk):
        sender = (random.choice(flagged_senders)
                  if (flagged_senders and random.random() < 0.55)
                  else random.choice(acc_numbers))
        receiver = random.choice(acc_numbers)
        while receiver == sender:
            receiver = random.choice(acc_numbers)

        amount = round(random.uniform(250000, 2500000), 2)  # ₹2.5L – ₹25L
        ts = start_time + timedelta(days=random.randint(0, 180),
                                    hours=rand_hour_biased(0.40))
        country = random.choice(HIGH_RISK_COUNTRIES)

        data.append({
            'transaction_id': make_tx_id(len(data)),
            'sender_account': sender,
            'sender_name': account_lookup[sender]['holder_name'],
            'receiver_account': receiver,
            'receiver_name': account_lookup[receiver]['holder_name'],
            'amount': amount,
            'currency': 'INR',
            'timestamp': ts.isoformat(),
            'country': country,
            'city': rand_city(country),
            'device_id': random.choice(devices),
            'ip_address': random.choice(ips),
            'payment_method': random.choice(['Crypto Transfer', 'RTGS', 'IMPS']),
            'merchant': random.choice(SUSPICIOUS_MERCHANTS),
            'category': random.choice(['Investment', 'Transfer', 'Services']),
            'status': 'Approved',
            'is_laundering': 1
        })

    # ─── 6. Rapid Velocity Bursts (many small transactions in minutes) ────────
    print("Generating rapid-velocity burst transactions...")
    num_bursts = 30
    for b in range(num_bursts):
        sender = random.choice(acc_numbers)
        burst_size = random.randint(6, 12)
        base_time = start_time + timedelta(days=random.randint(0, 180),
                                           hours=rand_hour_biased(0.50))

        for tx in range(burst_size):
            receiver = random.choice(acc_numbers)
            while receiver == sender:
                receiver = random.choice(acc_numbers)
            amount = round(random.uniform(50000, 500000), 2)  # ₹50K – ₹5L each
            timestamp = base_time + timedelta(minutes=random.randint(1, 8) * tx)

            data.append({
                'transaction_id': make_tx_id(len(data)),
                'sender_account': sender,
                'sender_name': account_lookup[sender]['holder_name'],
                'receiver_account': receiver,
                'receiver_name': account_lookup[receiver]['holder_name'],
                'amount': amount,
                'currency': 'INR',
                'timestamp': timestamp.isoformat(),
                'country': random.choice(NORMAL_COUNTRIES + HIGH_RISK_COUNTRIES),
                'city': rand_city('IN'),
                'device_id': random.choice(devices),
                'ip_address': random.choice(ips),
                'payment_method': random.choice(['IMPS', 'UPI', 'RTGS']),
                'merchant': random.choice(SUSPICIOUS_MERCHANTS),
                'category': 'Transfer',
                'status': 'Approved',
                'is_laundering': 1
            })

    # ─── Shuffle ──────────────────────────────────────────────────────────────
    random.shuffle(data)
    df = pd.DataFrame(data)

    # ─── Label Noise (realistic miss-rate) ───────────────────────────────────
    rng = np.random.default_rng(seed)
    laundering_idx = df.index[df['is_laundering'] == 1].tolist()
    clean_idx = df.index[df['is_laundering'] == 0].tolist()

    # ~4% of true laundering mislabeled as clean (historical compliance misses)
    flip_clean = rng.choice(laundering_idx, size=max(1, int(0.04 * len(laundering_idx))), replace=False)
    df.loc[flip_clean, 'is_laundering'] = 0

    # ~0.5% of clean mislabeled as laundering (false historical flags)
    flip_dirty = rng.choice(clean_idx, size=max(1, int(0.005 * len(clean_idx))), replace=False)
    df.loc[flip_dirty, 'is_laundering'] = 1

    output_path = os.path.join(os.path.dirname(__file__), 'dataset.csv')
    df.to_csv(output_path, index=False)

    total = len(df)
    fraud = df['is_laundering'].sum()
    print(f"\n[OK] Dataset saved to: {output_path}")
    print(f"   Total records  : {total:,}")
    print(f"   Laundering     : {fraud:,} ({round(fraud / total * 100, 2)}%)")
    print(f"   Clean          : {total - fraud:,} ({round((total - fraud) / total * 100, 2)}%)")
    return df


if __name__ == '__main__':
    generate_aml_data(15000)
