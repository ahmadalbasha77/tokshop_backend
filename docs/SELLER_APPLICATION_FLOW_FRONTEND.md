# Seller Application Flow - Flutter Integration Guide

## Summary

Seller application is now separated from Stripe Connect.

The app must no longer collect bank, payout, SSN, phone, or date of birth fields during seller application submission. Those fields belong only to the later payout setup step.

New flow:

1. User accepts seller guidelines.
2. User enters full address.
3. User may optionally add social links and seller questions.
4. Backend submits seller application without calling Stripe.
5. Admin approves or rejects the application.
6. After approval, seller may still have incomplete payout/profile information.
7. When seller tries actions that require payout/profile completion, backend returns `SELLER_PROFILE_INCOMPLETE`.
8. Flutter should then send seller to the Stripe Connect / payout setup screen.

## Do Not Use Stripe Connect For Seller Application

Do not use this endpoint for initial seller application anymore:

`POST /stripe/connect/:id`

That endpoint is still supported, but only after seller approval, when the seller is completing payout/bank/KYC information.

## New Seller Application Endpoint

### Path

`POST /users/seller/application`

Alternative path if submitting for a specific user:

`POST /users/seller/application/:id`

Both routes require the normal authenticated user token because `/users` routes are protected.

### Required Request Fields

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117"
}
```

### Optional Request Fields

```json
{
  "address_line_2": "Apt 4",
  "instagram_link": "https://instagram.com/example",
  "tiktok_link": "https://tiktok.com/@example",
  "facebook_link": "https://facebook.com/example",
  "website_link": "https://example.com",
  "has_livestream_experience": true,
  "referral_source": "Friend"
}
```

`has_livestream_experience` may be `true`, `false`, or `null`.

### Full Example Request

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "address_line_2": "Apt 4",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117",
  "instagram_link": "",
  "tiktok_link": "",
  "facebook_link": "",
  "website_link": "",
  "has_livestream_experience": null,
  "referral_source": ""
}
```

### Minimal Valid Request

This is enough to submit:

```json
{
  "seller_guidelines_accepted": true,
  "address_line_1": "123 Main St",
  "city": "San Francisco",
  "state": "CA",
  "country": "United States",
  "postal_code": "94117"
}
```

### Fields That Must Not Be Sent

Do not send these fields to the seller application endpoint:

```json
[
  "routing_number",
  "account_number",
  "bank_account_number",
  "ssn_last_4",
  "date_of_birth",
  "phone",
  "iban",
  "payout_account",
  "payment_details"
]
```

If Flutter sends these fields, backend returns `400`.

## Success Response

HTTP `201`

```json
{
  "success": true,
  "message": "Seller application submitted successfully.",
  "seller_application": {
    "status": "pending",
    "seller_guidelines_accepted": true,
    "guidelines_accepted_at": "2026-05-07T10:00:00.000Z",
    "instagram_link": "",
    "tiktok_link": "",
    "facebook_link": "",
    "website_link": "",
    "has_livestream_experience": null,
    "referral_source": "",
    "submitted_at": "2026-05-07T10:00:00.000Z",
    "reviewed_at": null,
    "reviewed_by": null,
    "rejection_reason": ""
  },
  "address": {
    "_id": "ADDRESS_ID",
    "addrress1": "123 Main St",
    "addrress2": "",
    "city": "San Francisco",
    "state": "CA",
    "country": "United States",
    "zipcode": "94117",
    "primary": true
  }
}
```

Note: address model uses legacy field spellings in the response:

- `addrress1` = `address_line_1`
- `addrress2` = `address_line_2`
- `zipcode` = `postal_code`

## Validation Errors

### Guidelines Not Accepted

HTTP `422`

```json
{
  "success": false,
  "message": "seller_guidelines_accepted must be true.",
  "missing_fields": ["seller_guidelines_accepted"]
}
```

### Missing Address Fields

HTTP `422`

```json
{
  "success": false,
  "message": "Full address is required.",
  "missing_fields": ["address_line_1", "city", "state", "country", "postal_code"]
}
```

### Payout Fields Sent Too Early

HTTP `400`

```json
{
  "success": false,
  "message": "Seller application does not accept payout or bank details.",
  "disallowed_fields": ["routing_number", "ssn_last_4"]
}
```

### User Is Already An Approved Seller

HTTP `409`

```json
{
  "success": false,
  "message": "User is already an approved seller.",
  "seller_application": {}
}
```

## Seller Application Status

Status is stored on the user object:

`user.seller_application.status`

Possible values:

- `pending`
- `approved`
- `rejected`

Useful user flags:

- `applied_seller = true` after application submit.
- `seller = false` while pending or rejected.
- `seller = true` after admin approval.
- `stripe_account` may still be `null` after approval.

Approved seller without `stripe_account` is valid. It means payout/profile setup is not complete yet.

## Admin Approval

Existing admin endpoint remains:

`PATCH /users/approveseller/:id`

Approve body:

```json
{
  "action": "approve"
}
```

Reject body:

```json
{
  "action": "reject",
  "rejection_reason": "Reason shown or stored for admin context"
}
```

On approval, backend sets:

- `seller = true`
- `applied_seller = true`
- `seller_application.status = approved`
- `seller_application.reviewed_at`
- `seller_application.reviewed_by` when available

If user already has `stripe_account`, backend keeps the old Stripe payout schedule update.
If user does not have `stripe_account`, approval still succeeds and Stripe is not called.

## Incomplete Seller Profile Error

Some seller actions require payout/KYC completion after approval.

Backend returns HTTP `403`:

```json
{
  "code": "SELLER_PROFILE_INCOMPLETE",
  "message": "Please complete your seller account information before continuing.",
  "missing_fields": [
    "payout_account",
    "stripe_account",
    "phone_number",
    "date_of_birth",
    "ssn_last_4",
    "bank_account"
  ]
}
```

Flutter handling:

1. Detect `code == SELLER_PROFILE_INCOMPLETE`.
2. Show a clear CTA such as "Complete seller account".
3. Navigate to the payout/Stripe Connect setup screen.
4. After Stripe Connect succeeds, retry the blocked action.

## Actions That Can Return SELLER_PROFILE_INCOMPLETE

The backend now guards:

- Create product: `POST /products/:useId`
- Bulk create products: `POST /products/products/bulkadd`
- Bulk publish/update products: `PUT /products/products/bulkedit/all`, `PUT /products/update`
- Publish/update product paths when publishing-related fields are sent
- Create live room/livestream: `POST /rooms`
- Create auction/live sale: `POST /auction`
- Start auction over socket event: `start-auction`
- Stripe bank listing: `GET /stripe/banks/:userId`
- Stripe payout: `POST /stripe/payouts/:userId`
- Stripe transfer: `POST /stripe/transfer`
- Stripe payout transactions: `GET /stripe/transactions/:userId`

Socket `start-auction` emits `auction-error` with the same object:

```json
{
  "code": "SELLER_PROFILE_INCOMPLETE",
  "message": "Please complete your seller account information before continuing.",
  "missing_fields": ["payout_account", "stripe_account", "phone_number", "date_of_birth", "ssn_last_4", "bank_account"]
}
```

## Stripe Connect / Payout Setup

Use this only after seller approval:

`POST /stripe/connect/:id`

Required fields remain the existing payout/KYC fields expected by Stripe Connect, for example:

```json
{
  "email": "seller@example.com",
  "first_name": "Jane",
  "last_name": "Seller",
  "routing_number": "110000000",
  "account_number": "000123456789",
  "phone": "+14155552671",
  "country": "United States",
  "postal_code": "94117",
  "line1": "123 Main St",
  "line2": "",
  "state": "CA",
  "city": "San Francisco",
  "day": 10,
  "month": 10,
  "year": 1985,
  "ssn_last_4": "0000",
  "countryCode": "US",
  "create_address": false
}
```

For non-US sellers, the existing endpoint supports `iban` and `countryCode`.

If seller is not approved yet, backend returns:

HTTP `403`

```json
{
  "success": false,
  "code": "SELLER_NOT_APPROVED",
  "message": "Seller approval is required before completing payout setup."
}
```

On success, Stripe account is created and saved to `user.stripe_account`.

## Screen Changes Needed

### Seller Application Screens

Keep:

- Seller guidelines acceptance checkbox.
- Full address form.
- Optional social links form.
- Optional questions.

Remove or move out of seller application:

- Bank account number.
- Routing number.
- SSN last 4.
- Date of birth.
- Phone number.
- IBAN.
- Payout/payment details.

### Payout Setup Screen

Move bank/KYC fields to a separate "Complete seller account" or "Payout setup" screen.

Show this screen only:

- After admin approval, or
- When backend returns `SELLER_PROFILE_INCOMPLETE`.

### Status UI

Suggested UI behavior:

- `seller_application.status == pending`: show "Application under review".
- `seller_application.status == rejected`: show rejected state and allow resubmit if product wants that.
- `seller == true` and `stripe_account == null`: show seller dashboard but gate payout-required actions with "Complete seller account".
- `seller == true` and `stripe_account != null`: seller profile is payout-ready.

## Backward Compatibility Notes

Existing sellers with `stripe_account` should continue using product/live/auction/payout flows.

Existing `/stripe/connect/:id` is not removed. It is only repositioned in the app flow.

Frontend should migrate from old initial seller application behavior:

Old:

`Seller application screen -> /stripe/connect/:id`

New:

`Seller application screen -> /users/seller/application`

Then later:

`Approved seller payout setup screen -> /stripe/connect/:id`
