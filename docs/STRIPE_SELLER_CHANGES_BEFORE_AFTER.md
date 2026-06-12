# سجل تغييرات البائع وStripe والمزاد

تاريخ إعداد المستند: 8 يونيو 2026

هذا المستند يسجل الحالة القديمة والجديدة لتدفقات:

- طلب الانضمام كبائع.
- موافقة الإدارة على البائع.
- إنشاء Stripe Connected Account.
- استكمال Stripe Hosted Onboarding ورفع مستند الهوية.
- التحقق من أهلية البائع للبيع.
- إنشاء المنتجات واللايف والمزادات.
- تحصيل دفعة الفائز بالمزاد.
- التحويلات والسحوبات الخاصة بالبائع.

هذا المستند مكمل لـ:

- `docs/SELLER_APPLICATION_FLOW_FRONTEND.md`
- `docs/NOTIFICATIONS_AUDIT_ISSUES.md`

ولا يستبدل أيًا منهما.

## 1. سبب التغييرات

كانت هناك عدة مشاكل مترابطة:

1. طلب الانضمام كبائع كان مرتبطًا مباشرة بإنشاء حساب Stripe.
2. التطبيق كان يجمع بيانات البنك وSSN مبكرًا أثناء طلب البائع.
3. نجاح إنشاء حساب Stripe كان يُفهم خطأً على أنه أهلية كاملة للبيع.
4. الحسابات Restricted أو التي تحتاج مستند هوية كانت تستطيع الوصول إلى إنشاء منتج أو لايف أو مزاد.
5. لم يكن Backend يعيد حالة `pending_verification` بوضوح.
6. بعد رفع المستند لم يكن Flutter يستطيع التمييز بين:
   - مستند ناقص.
   - مستند مرفوع وتحت المراجعة.
   - مستند مرفوض ويحتاج إعادة رفع.
7. لم يكن هناك endpoint مخصص لإنشاء Stripe Account Link.
8. بعض المسارات المالية لم تتحقق أن المستخدم الحالي هو صاحب الحساب.
9. أخطاء دفع المزاد كانت تصل بصيغة غير مفيدة مثل:

```json
{
  "message": "undefined payment failed"
}
```

10. بعض قيم المزايدة كانت نصوصًا أو غير صالحة، ما أدى إلى قيم مثل `NaN` وتناقض بين:
    - `higestbid`
    - `baseprice`
    - `newbaseprice`

## 2. الشكل العام قبل التعديل

كان التدفق القديم قريبًا من التالي:

```text
طلب بائع
  -> جمع بيانات البنك وSSN
  -> POST /stripe/connect/:id
  -> إنشاء Stripe Connected Account
  -> success: true
  -> اعتبار العملية ناجحة
  -> موافقة الإدارة أو السماح بتدفقات البيع
```

المشاكل في هذا التدفق:

- خلط قرار الإدارة مع متطلبات Stripe.
- تخزين/نقل بيانات حساسة قبل الحاجة إليها.
- عدم معرفة هل `charges_enabled` و`payouts_enabled` فعّالان.
- عدم معرفة هل مستند الهوية تحت المراجعة.
- إمكانية تكرار إنشاء Stripe Account.
- عدم جمع المتطلبات المستقبلية قبل أن توقف الحساب.

## 3. الشكل العام بعد التعديل

أصبح التدفق الجديد:

```text
1. إرسال طلب البائع بدون بنك أو SSN
2. مراجعة الإدارة
3. موافقة الإدارة
4. إدخال بيانات البنك وKYC
5. إنشاء Stripe Connected Account مرة واحدة
6. قراءة حالة الحساب الحقيقية من Stripe
7. إنشاء Stripe Hosted Onboarding Link عند وجود متطلبات
8. رفع المستند مباشرة إلى Stripe
9. إعادة فحص الأهلية
10. السماح بالبيع فقط عندما can_sell == true
```

قاعدة السماح النهائية:

```text
seller approved
AND Stripe account exists
AND charges_enabled == true
AND payouts_enabled == true
AND payment capabilities are active
AND no actionable requirements exist
AND verification is not pending
```

## 4. التسلسل الزمني للتغييرات

### 4.1 فصل طلب البائع عن Stripe

Commit:

```text
9538759 Separate seller application from Stripe onboarding
```

تم في هذه المرحلة:

- إضافة نموذج `seller_application` إلى المستخدم.
- إضافة endpoint مستقل لطلب البائع.
- منع إرسال بيانات البنك وSSN إلى طلب البائع.
- السماح للإدارة بالموافقة أو الرفض دون الحاجة إلى Stripe Account.
- إضافة حواجز أولية للمنتجات واللايف والمزاد.
- إضافة خطأ `SELLER_PROFILE_INCOMPLETE`.

### 4.2 حفظ بيانات الاتصال والعنوان

Commits:

```text
acf17e4 Fix address phone and email persistence
566842a Persist seller application contact info
b19d294 Save seller application country code
0bb89c4 Normalize Stripe Connect country code
```

تم في هذه المرحلة:

- حفظ الهاتف والبريد مع عنوان طلب البائع.
- حفظ `countryCode`.
- تحويل أسماء مثل `United States` و`USA` إلى `US`.
- منع إرسال Country Code غير صالح إلى Stripe.

### 4.3 إصلاح دفع المزاد

Commit:

```text
20f227f Fix auction payment failure handling
```

تم في هذه المرحلة:

- تحويل مبلغ المزايدة إلى رقم والتحقق أنه صالح.
- منع `NaN` في المزايدة.
- تحديث `higestbid`.
- حساب `newbaseprice` من أعلى مزايدة فعلية.
- التحقق من وجود Stripe customer وPayment Method.
- إضافة `payment_method_types: ["card"]` في المسار المطلوب.
- الاحتفاظ بخطأ Stripe الأصلي.
- إرجاع `code`, `type`, `declineCode`, `providerMessage` و`paymentIntentId`.
- استبدال `undefined payment failed` برسالة منظمة.

### 4.4 إضافة التحقق الكامل من حالة Stripe

التعديلات الحالية غير المرفوعة وقت كتابة هذا المستند:

- إضافة محلل مركزي لحالة Stripe.
- إضافة Seller Eligibility API.
- إضافة Stripe Hosted Onboarding Link API.
- دعم المستند تحت المراجعة.
- دعم المتطلبات المستقبلية.
- إضافة Webhook `account.updated`.
- توسيع الحواجز إلى جميع مسارات البيع والسحب والتحويل.
- إضافة اختبارات حالات Stripe.

## 5. طلب البائع قبل وبعد

### قبل

كان Flutter يستخدم:

```http
POST /stripe/connect/:id
```

كجزء من طلب الانضمام كبائع، ويرسل:

- البنك.
- Routing Number.
- SSN last 4.
- تاريخ الميلاد.
- الهاتف.
- العنوان.

### بعد

يستخدم Flutter لطلب البائع:

```http
POST /users/seller/application
```

أو:

```http
POST /users/seller/application/:id
```

الحقول المطلوبة:

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

الحقول الاختيارية:

```json
{
  "address_line_2": "Apt 4",
  "instagram_link": "",
  "tiktok_link": "",
  "facebook_link": "",
  "website_link": "",
  "has_livestream_experience": null,
  "referral_source": ""
}
```

الحقول الممنوعة:

```text
routing_number
account_number
bank_account_number
ssn_last_4
date_of_birth
iban
payout_account
payment_details
```

إذا وصلت هذه الحقول يرجع Backend:

```json
{
  "success": false,
  "message": "Seller application does not accept payout or bank details.",
  "disallowed_fields": ["routing_number", "ssn_last_4"]
}
```

## 6. حالة طلب البائع

تمت إضافة الكائن التالي إلى User Model:

```json
{
  "seller_application": {
    "status": "pending",
    "seller_guidelines_accepted": true,
    "guidelines_accepted_at": "date",
    "instagram_link": "",
    "tiktok_link": "",
    "facebook_link": "",
    "website_link": "",
    "has_livestream_experience": null,
    "referral_source": "",
    "submitted_at": "date",
    "reviewed_at": null,
    "reviewed_by": null,
    "rejection_reason": ""
  }
}
```

القيم الممكنة لـ`status`:

```text
pending
approved
rejected
```

### قبل

- كان `seller` و`applied_seller` هما المصدر الأساسي للحالة.
- لم يكن هناك سجل واضح لوقت الإرسال أو المراجعة أو سبب الرفض.
- موافقة الإدارة قد تحاول تحديث Stripe حتى لو لم يوجد حساب.

### بعد

- الطلب الجديد يضع:

```text
applied_seller = true
seller = false
seller_application.status = pending
```

- الموافقة تضع:

```text
seller = true
seller_application.status = approved
```

- الرفض يضع:

```text
seller = false
seller_application.status = rejected
seller_application.rejection_reason = reason
```

- موافقة الإدارة تنجح حتى لو لم يوجد `stripe_account`.
- تحديث Stripe payout schedule يحدث فقط إذا كان حساب Stripe موجودًا.

## 7. إنشاء Stripe Connected Account قبل وبعد

Endpoint:

```http
POST /stripe/connect/:id
```

### قبل

- قد يتم استدعاؤه قبل موافقة الإدارة.
- كان يطبع `req.body` الذي قد يحتوي SSN والبنك.
- لم يمنع المستخدم من إدارة Stripe Account لمستخدم آخر.
- قد ينشئ حسابًا جديدًا عند تكرار الطلب.
- كان `success: true` يعني فقط أن الإنشاء نجح، لكن Flutter قد يعتبره جاهزًا للبيع.
- كان Backend يرسل `tos_acceptance` نيابة عن المستخدم.
- لم تكن حالة الحساب تُعاد بشكل موحد.

### بعد

- يسمح لصاحب الحساب أو الأدمن فقط.
- يتطلب أن يكون المستخدم بائعًا موافقًا عليه.
- لا يطبع بيانات البنك أو SSN.
- يطبع الأخطاء الآمنة فقط دون payload الحساس.
- إذا كان `stripe_account` موجودًا:
  - لا ينشئ حسابًا جديدًا.
  - يجلب الحساب الموجود من Stripe.
  - يعيد حالته الحالية.
- إنشاء الحساب يستخدم Idempotency Key:

```text
seller-connect-{userId}
```

- تم إزالة `tos_acceptance` اليدوي من إنشاء الحساب.
- Stripe Hosted Onboarding هو المسؤول عن قبول الشروط واستكمال KYC.
- حسابات الولايات المتحدة تتطلب:

```text
ssn_last_4 = 4 digits
ssn_last_4 != 0000
```

- `countryCode` يجب أن يكون ISO من حرفين.
- وضع Demo لا يستطيع إنشاء بيانات تجريبية باستخدام Live Secret Key.

### استجابة الإنشاء الجديدة

```json
{
  "success": true,
  "account_created": true,
  "account_id": "acct_...",
  "can_sell": false,
  "onboarding_required": true,
  "verification_pending": false,
  "code": "STRIPE_ONBOARDING_REQUIRED",
  "stripe_status": {},
  "bank": {}
}
```

مهم:

```text
success == true
```

يعني أن Stripe Account موجود، ولا يعني أن البائع مؤهل للبيع.

## 8. Stripe Account Status Parser

تمت إضافة ملف جديد:

```text
src/shared/stripeAccountStatus.js
```

وظيفته تحويل Stripe Account إلى حالة موحدة يمكن استخدامها في REST وSocket وWebhook.

يقرأ:

```text
charges_enabled
payouts_enabled
details_submitted
capabilities.card_payments
capabilities.transfers
capabilities.legacy_payments
requirements.disabled_reason
requirements.current_deadline
requirements.currently_due
requirements.past_due
requirements.eventually_due
requirements.pending_verification
requirements.errors
future_requirements.*
```

ويعيد:

```json
{
  "ready": false,
  "can_sell": false,
  "onboarding_required": true,
  "verification_pending": false,
  "charges_enabled": false,
  "payouts_enabled": false,
  "card_payments": "pending",
  "transfers": "pending",
  "legacy_payments": "inactive",
  "details_submitted": true,
  "disabled_reason": "requirements.past_due",
  "current_deadline": null,
  "currently_due": [],
  "past_due": [],
  "eventually_due": [],
  "pending_verification": [],
  "errors": [],
  "future_requirements": {}
}
```

### دعم الحسابات القديمة

بعض حسابات Stripe القديمة تستخدم:

```text
capabilities.legacy_payments
```

بدل:

```text
card_payments
transfers
```

تم دعم `legacy_payments == active` حتى لا يتم منع بائع قديم صالح.

## 9. أكواد حالة Stripe

### `STRIPE_ACCOUNT_READY`

الحساب جاهز ولا توجد متطلبات أو مراجعة معلقة.

### `STRIPE_ONBOARDING_REQUIRED`

هناك معلومات قابلة للإكمال الآن، مثل:

- SSN كامل.
- مستند هوية.
- تاريخ ميلاد.
- عنوان.
- معلومات بنك.
- مستند مرفوض.

### `STRIPE_FUTURE_REQUIREMENTS_PENDING`

الحساب قد يكون فعالًا حاليًا، لكن توجد متطلبات مستقبلية يمكن جمعها الآن لتجنب توقف الحساب لاحقًا.

### `STRIPE_VERIFICATION_PENDING`

المستند أو المعلومات تم إرسالها وهي تحت مراجعة Stripe.

في هذه الحالة:

```text
verification_pending = true
onboarding_required = false
can_sell = false
```

لا يتم إنشاء رابط جديد بلا داعٍ.

### `STRIPE_ACCOUNT_RESTRICTED`

الحساب غير جاهز ولا توجد معلومات قابلة للإكمال عبر Account Link، مثل حالات الرفض النهائية أو القيود الخاصة بالحساب.

### `SELLER_STRIPE_ACCOUNT_RESTRICTED`

الكود المستخدم من حواجز البيع عندما يكون حساب Stripe غير فعال.

### `SELLER_STRIPE_STATUS_UNAVAILABLE`

تعذر الاتصال بـStripe أو قراءة الحالة.

يرجع عادة HTTP `503` ويجب السماح للمستخدم بالمحاولة مرة أخرى.

## 10. Seller Eligibility API

تمت إضافة:

```http
GET /users/seller/eligibility/:userId
```

المسار محمي بـJWT.

يسمح:

- للمستخدم بقراءة حالته فقط.
- للأدمن بقراءة حالة أي مستخدم.

يرفض محاولة قراءة حساب مستخدم آخر:

```json
{
  "success": false,
  "can_sell": false,
  "code": "SELLER_ELIGIBILITY_ACCESS_DENIED",
  "message": "You cannot view another seller's Stripe eligibility."
}
```

### مثال حساب جاهز

```json
{
  "success": true,
  "can_sell": true,
  "code": "SELLER_ELIGIBLE",
  "seller_approved": true,
  "profile_complete": true,
  "onboarding_required": false,
  "verification_pending": false,
  "stripe_status": {}
}
```

### مثال حساب Stripe مفقود

```json
{
  "success": false,
  "can_sell": false,
  "code": "SELLER_PROFILE_INCOMPLETE",
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

### مثال مستند تحت المراجعة

```json
{
  "success": false,
  "can_sell": false,
  "code": "STRIPE_VERIFICATION_PENDING",
  "onboarding_required": false,
  "verification_pending": true,
  "stripe_status": {
    "pending_verification": [
      "individual.verification.document"
    ]
  }
}
```

## 11. Stripe Hosted Onboarding

تمت إضافة:

```http
POST /stripe/connect/:id/onboarding-link
```

Body:

```json
{
  "refresh_url": "https://steelz.live/stripe/refresh",
  "return_url": "https://steelz.live/stripe/return"
}
```

يتم إنشاء الرابط باستخدام:

```json
{
  "type": "account_onboarding",
  "collection_options": {
    "fields": "currently_due",
    "future_requirements": "omit"
  }
}
```

إذا أعاد Stripe المتطلب المستقبلي
`individual.verification.document`، يبدّل Backend هذا الحساب فقط إلى:

```json
{
  "collection_options": {
    "fields": "eventually_due",
    "future_requirements": "include"
  }
}
```

النتيجة:

- Stripe يجمع المتطلبات الحالية.
- Stripe لا يطلب المتطلبات المستقبلية الأخرى قبل أن تصبح مطلوبة.
- وثيقة الهوية المستقبلية تمنع البيع ويتم طلبها مسبقًا.
- مستند الهوية يذهب مباشرة إلى Stripe.
- Backend وFlutter لا يخزنان صورة المستند.
- Account Link مؤقت ويستخدم مرة واحدة.
- استجابات Stripe تعيد `next_action` و`requires_onboarding_link` حتى لا يعتبر
  Flutter كل حالة `can_sell=false` خطأ عامًا.

قيم `next_action`:

```text
OPEN_STRIPE_ONBOARDING
WAIT_FOR_STRIPE_VERIFICATION
SELLER_READY
CONTACT_SUPPORT
WAIT_FOR_SELLER_APPROVAL
COMPLETE_SELLER_PROFILE
```

### حماية روابط العودة

يسمح افتراضيًا فقط بـ:

```text
steelz.live
www.steelz.live
iconaapp.com
www.iconaapp.com
```

يمكن إضافة hosts أخرى عبر:

```text
STRIPE_ONBOARDING_ALLOWED_HOSTS
```

الشروط:

- HTTPS إلزامي.
- HTTP مسموح فقط لـ`localhost` و`127.0.0.1`.
- `refresh_url` يجب أن يكون مساره `/stripe/refresh`.
- `return_url` يجب أن يكون مساره `/stripe/return`.
- لا يسمح username أو password داخل URL.

## 12. سلوك المستند تحت المراجعة

### قبل

لم يكن هناك فرق واضح بين:

```text
document missing
document pending
document rejected
```

وقد يتم إرسال المستخدم إلى رابط Stripe مرارًا.

### بعد

#### مستند ناقص

```text
onboarding_required = true
verification_pending = false
```

يتم فتح Onboarding.

#### مستند مرفوع وتحت المراجعة

```text
onboarding_required = false
verification_pending = true
```

لا يتم فتح الرابط.

#### مستند مرفوض أو غير مقروء

```text
errors is not empty
onboarding_required = true
```

يتم فتح Onboarding لإعادة الإرسال.

#### مستند تحت المراجعة ومتطلب آخر ناقص

```text
verification_pending = true
onboarding_required = true
```

يتم فتح Onboarding للمتطلب الآخر، وليس لإعادة رفع المستند المعلق.

## 13. Webhook حالة الحساب

تمت إضافة معالجة:

```text
account.updated
```

في:

```text
src/controllers/webhookController.js
```

عند وصول الحدث:

1. يتم تحليل Stripe Account.
2. يتم البحث عن المستخدم بواسطة `stripe_account`.
3. يتم تحديث ملخص غير حساس.

الحقول الجديدة في User Model:

```text
stripe_status_code
stripe_verification_pending
stripe_status_updated_at
```

الحالة الحية من Stripe تبقى المصدر النهائي قبل أي عملية بيع.

يجب تفعيل `account.updated` للحسابات المتصلة داخل Stripe Dashboard.

## 14. حواجز المنتجات واللايف والمزاد

### قبل

كانت بعض المسارات تتحقق فقط من:

```text
seller == true
stripe_account exists
```

وجود Stripe Account لا يعني أنه فعال.

### بعد

الحاجز المركزي يتحقق من:

1. المستخدم موجود.
2. الإدارة وافقت عليه.
3. Stripe Account موجود.
4. الحالة الحية من Stripe قابلة للبيع.

المسارات المحمية تشمل:

### المنتجات

- إنشاء منتج.
- Bulk create.
- Bulk update عند النشر.
- تحديث منتج عند تغيير حقول النشر.
- نشر عدة منتجات.

### اللايف

- إنشاء غرفة.
- بدء أو إعادة جدولة غرفة.
- إصدار LiveKit publish token للمضيف أو co-host.
- Socket event `start-room`.

### المزاد

- إنشاء مزاد.
- بدء المزاد.
- تثبيت المزاد.
- تثبيت المنتج.
- بدء flash sale.
- مسارات Socket المختلفة للمزاد والمنتج.

### الاستجابة عند المنع

REST يرجع عادة HTTP `403`:

```json
{
  "success": false,
  "can_sell": false,
  "code": "STRIPE_VERIFICATION_PENDING",
  "message": "...",
  "onboarding_required": false,
  "verification_pending": true,
  "stripe_status": {}
}
```

Socket يرجع نفس object عبر:

```text
auction-error
room-error
product-error
```

## 15. الدفع وإنشاء الطلبات

تمت إضافة فحص حالة Stripe للبائع قبل:

- `createOrder`
- `retryOrderPayment`

### قبل

كان الطلب قد يصل إلى إنشاء PaymentIntent ثم يفشل بسبب حساب البائع Restricted.

### بعد

إذا كان حساب البائع غير مؤهل:

- لا تبدأ محاولة دفع جديدة.
- يرجع خطأ غير قابل لإعادة المحاولة تلقائيًا للحالة المقيدة.
- إذا تعذر قراءة Stripe، يرجع خطأ مؤقت قابل لإعادة المحاولة.

مثال:

```json
{
  "success": false,
  "retryable": false,
  "code": "SELLER_STRIPE_ACCOUNT_RESTRICTED"
}
```

## 16. إصلاح أخطاء دفع المزاد

### قبل

كان Socket قد يرسل:

```json
{
  "message": "undefined payment failed"
}
```

وكان الخطأ الأصلي من Stripe يضيع.

### بعد

يتم تسجيل:

```text
message
stack
code
type
decline_code
providerMessage
paymentIntentId
requestId
providerResponse
auctionId
userId
```

ويتم إرسال payload آمن للعميل:

```json
{
  "message": "Payment failed",
  "code": "card_declined",
  "providerMessage": "...",
  "declineCode": "...",
  "auctionId": "...",
  "userId": "...",
  "paymentIntentId": "..."
}
```

## 17. إصلاح حساب المزايدة

### قبل

كان `amount` قد يبقى String أو يتحول إلى `NaN`.

وقد تصبح القيم:

```text
increaseBidBy = 7
amount = 1
newbaseprice = 2
higestbid = 0
```

دون مزامنة واضحة.

### بعد

- يتم تنفيذ:

```js
const bidAmount = Number(amount);
```

- يتم رفض القيمة غير الصالحة.
- يتم تحديث:

```text
higestbid = highestBid
baseprice = highestBid
newbaseprice = highestBid + 1
```

- يتم تطبيق ذلك في REST وSocket وAutobid ونهاية المزاد.

## 18. السحب والتحويل قبل وبعد

المسارات:

```text
GET /stripe/banks/:userId
GET /stripe/transactions/:userId
POST /stripe/payouts/:userId
POST /stripe/transfer
```

### قبل

- JWT كان مطلوبًا، لكن بعض المسارات لم تتحقق أن `userId` يخص المستخدم الحالي.
- المبلغ الصفري أو السالب لم يكن مرفوضًا بشكل موحد.
- بيانات بنكية وكائنات Stripe كانت تظهر في logs.
- وجود `stripe_account` كان كافيًا قبل السحب.

### بعد

- يسمح لصاحب الحساب أو الأدمن فقط.
- أي مستخدم آخر يأخذ:

```json
{
  "success": false,
  "code": "STRIPE_ACCOUNT_ACCESS_DENIED",
  "message": "You cannot manage another user's Stripe account."
}
```

- المبلغ يجب أن يكون رقمًا موجبًا.
- يتم التحقق من حالة Stripe الحية قبل خصم الرصيد.
- تمت إزالة logs الخاصة بـ:
  - Request body.
  - الحساب البنكي.
  - Stripe Account ID.
  - Transfer object.

## 19. قبول العروض

### قبل

كان العرض يتحول إلى:

```text
status = accepted
```

قبل نجاح إنشاء الطلب.

إذا فشل الدفع أو منع Stripe العملية، كان العرض يبقى مقبولًا دون طلب ناجح.

### بعد

يتم إنشاء الطلب أولًا.

فقط بعد نجاحه يتم:

```text
offer.status = accepted
offer.acceptedAt = now
```

هذا الإصلاح يحمي من فشل Stripe وفشل البطاقة وأي فشل آخر في إنشاء الطلب.

## 20. حماية الحقول المدارة من السيرفر

تم منع المستخدم العادي من تعديل الحقول التالية عبر تحديث الملف الشخصي العام:

```text
stripe_account
stripe_status_code
stripe_verification_pending
stripe_status_updated_at
```

الأدمن فقط يستطيع تمريرها عبر المسار العام، بينما التحديث الطبيعي يتم من كود Stripe وWebhook.

الهدف:

- منع ربط حساب Stripe مزيف.
- منع تزوير `verification_pending`.
- منع تجاوز Eligibility.

## 21. الخصوصية والسجلات

تمت إزالة طباعة:

- Stripe Connect request body.
- SSN.
- Routing Number.
- Account Number.
- Webhook raw body.
- الحسابات البنكية.
- Stripe Account ID من مسارات السحب.
- Payment Method request body غير الضروري.

لا يتم تخزين صورة الهوية في قاعدة البيانات أو Flutter.

المستند يرفع مباشرة إلى Stripe Hosted Onboarding.

## 22. الملفات المعدلة تاريخيًا

### طلب البائع

```text
src/controllers/users.js
src/models/user.js
src/routes/user.js
src/shared/sellerProfile.js
src/controllers/products.js
src/controllers/rooms.js
src/controllers/auction.js
src/socket/services/auction.service.js
src/socket/socketEvents.js
docs/SELLER_APPLICATION_FLOW_FRONTEND.md
```

### دفع المزاد

```text
src/controllers/auction.js
src/shared/functions.js
src/socket/socketEvents.js
```

### Stripe Eligibility وOnboarding الحالية

```text
src/shared/stripeAccountStatus.js
src/shared/sellerProfile.js
src/controllers/stripe.js
src/controllers/users.js
src/controllers/webhookController.js
src/models/user.js
src/routes/stripe.js
src/routes/user.js
src/controllers/auction.js
src/controllers/rooms.js
src/controllers/offers.js
src/routes/livekit.js
src/shared/functions.js
src/socket/handlers/room.handlers.js
src/socket/services/auction.service.js
src/socket/socketEvents.js
package.json
test/stripeAccountStatus.test.js
docs/SELLER_APPLICATION_FLOW_FRONTEND.md
```

## 23. مقارنة الملفات قبل وبعد

| الملف | قبل | بعد |
|---|---|---|
| `src/shared/stripeAccountStatus.js` | غير موجود | مصدر مركزي لتحليل Stripe Account |
| `src/shared/sellerProfile.js` | يتحقق من وجود Stripe Account فقط | يتحقق من حالة Stripe الحية ويعيد أكواد موحدة |
| `src/controllers/users.js` | لا يوجد Eligibility endpoint | يوفّر Seller Eligibility ويحمي حقول Stripe |
| `src/controllers/stripe.js` | إنشاء مباشر وحالة غير واضحة | إنشاء idempotent، Onboarding، صلاحيات، فحص حي |
| `src/controllers/webhookController.js` | لا يعالج `account.updated` | يحدث ملخص الحالة عند تغير الحساب |
| `src/models/user.js` | لا يوجد ملخص لحالة Stripe | حقول code/pending/update time |
| `src/shared/functions.js` | الدفع يبدأ دون فحص أهلية البائع | فحص Stripe قبل الدفع وإعادة المحاولة |
| `src/controllers/offers.js` | قبول العرض قبل نجاح الطلب | قبول العرض بعد نجاح الطلب |
| `src/controllers/auction.js` | حماية جزئية وقيم bid غير موحدة | حماية بدء/تثبيت المزاد وقيم رقمية |
| `src/controllers/rooms.js` | حماية الإنشاء فقط | حماية الإنشاء والبدء وإعادة الجدولة |
| `src/routes/livekit.js` | المضيف يحصل على publish token دون فحص Stripe | فحص صاحب الغرفة قبل النشر |
| `src/socket/socketEvents.js` | أخطاء متفرقة | Handler مركزي وحواجز وأخطاء دفع منظمة |
| `package.json` | لا يوجد test script | `npm test` لتشغيل اختبارات Stripe status |

## 24. الاختبارات المضافة

الملف:

```text
test/stripeAccountStatus.test.js
```

يغطي:

1. حساب فعال مع متطلبات مستقبلية.
2. حساب Restricted.
3. حساب فعال بالكامل.
4. مستند تحت المراجعة.
5. مستند تحت المراجعة مع متطلب آخر.
6. مستند مرفوض أو غير مقروء.
7. حساب `under_review`.
8. حساب مرفوض نهائيًا.
9. `transfers` غير فعالة.
10. `disabled_reason` مع قائمة متطلبات غير موسعة.
11. حساب قديم يستخدم `legacy_payments`.

أمر التشغيل:

```bash
npm test
```

آخر نتيجة:

```text
stripe account status tests passed
```

تم أيضًا فحص صياغة جميع ملفات JavaScript داخل `src`:

```text
SYNTAX_OK 119 files
```

## 25. ما لم يتغير

لم يتم تغيير منطق:

- إضافة بطاقة المشتري.
- حذف بطاقة المشتري.
- اختيار البطاقة الافتراضية.
- SetupIntent للمشتري.
- عرض Saved Payment Methods.
- Checkout UI في Flutter.
- Seller Application endpoint بعد تثبيت عقده.

ملاحظة:

تمت إضافة فحص أهلية البائع قبل إنشاء الطلب أو Retry Payment. هذا لا يغير بطاقة المشتري، لكنه يمنع محاولة الدفع إذا كان حساب البائع نفسه غير صالح.

## 26. عقد Flutter النهائي

Flutter يجب أن يسمح بالبيع فقط عندما:

```text
can_sell == true
AND onboarding_required == false
AND verification_pending == false
```

التصرف حسب الكود:

| code | تصرف Flutter |
|---|---|
| `SELLER_ELIGIBLE` | السماح بالمتابعة |
| `SELLER_NOT_APPROVED` | عرض حالة انتظار/رفض الإدارة |
| `SELLER_PROFILE_INCOMPLETE` | فتح إعداد البنك فقط إذا `missing_fields` تحتوي `stripe_account` |
| `STRIPE_ONBOARDING_REQUIRED` | طلب رابط وفتح المتصفح |
| `STRIPE_FUTURE_REQUIREMENTS_PENDING` | فتح Onboarding لجمع المتطلبات المستقبلية |
| `STRIPE_VERIFICATION_PENDING` | عرض "تحت المراجعة" دون فتح الرابط |
| `SELLER_STRIPE_ACCOUNT_RESTRICTED` | منع البيع، وفتح الرابط فقط إذا `onboarding_required == true` |
| `SELLER_STRIPE_STATUS_UNAVAILABLE` | Retry |
| `STRIPE_ACCOUNT_ACCESS_DENIED` | منع العملية وعدم إعادة المحاولة |

## 27. متطلبات التشغيل والنشر

قبل النشر يجب:

1. إضافة الملف الجديد إلى Git:

```text
src/shared/stripeAccountStatus.js
```

2. إضافة الاختبار:

```text
test/stripeAccountStatus.test.js
```

3. التأكد من رفع جميع الملفات المعدلة معًا.
4. تفعيل `account.updated` للحسابات المتصلة في Stripe Dashboard.
5. التأكد من أن Deep Links تعمل:

```text
https://steelz.live/stripe/return
https://steelz.live/stripe/refresh
```

6. التأكد من ملفات:

```text
https://steelz.live/.well-known/assetlinks.json
https://steelz.live/.well-known/apple-app-site-association
```

7. اختبار Stripe Test Mode قبل Live Mode.

## 28. سيناريو اختبار نهائي

### حساب جديد

```text
Seller application
-> Admin approval
-> Bank/KYC form
-> POST /stripe/connect/:id
-> onboarding_required == true
-> POST onboarding-link
-> External browser
```

### بعد رفع مستند

```text
Return to app
-> GET eligibility
-> STRIPE_VERIFICATION_PENDING
-> Show under review
-> Do not reopen onboarding
```

### بعد موافقة Stripe

```text
account.updated webhook
-> GET eligibility
-> SELLER_ELIGIBLE
-> can_sell == true
-> allow product/live/auction
```

### مستند مرفوض

```text
account.updated webhook
-> errors returned
-> onboarding_required == true
-> request a new Account Link
```

### حساب Restricted أثناء التشغيل

```text
Protected seller action
-> live Stripe status check
-> HTTP 403 or socket error
-> no product/live/auction/payment/payout mutation
```

## 29. حدود معروفة

1. Stripe هو الذي يحدد هل مستند الهوية مطلوب.
2. `currently_due` يجمع المطلوب الآن، لكن ظهور `individual.verification.document` مستقبليًا يفعّل جمع الوثيقة مسبقًا قبل السماح بالبيع.
3. فرض التحقق من الهوية على جميع البائعين بغض النظر عن متطلبات Connect يحتاج منتجًا أو إعدادًا إضافيًا مثل Stripe Identity أو Additional Verifications إذا كان متاحًا للحساب.
4. Webhook يخزن ملخصًا فقط؛ فحص Stripe الحي يبقى المرجع النهائي.
5. تعذر تشغيل التطبيق كاملًا محليًا وقت المراجعة لأن `node_modules` غير موجود ولا يوجد `package-lock.json`.
6. اختبارات المنطق وفحص صياغة JavaScript نجحت، لكن ما زال اختبار Stripe end-to-end مطلوبًا.

## 30. ملفات موجودة في Working Tree وليست جزءًا من هذا التغيير

وقت إنشاء المستند كانت الملفات التالية موجودة كملفات أخرى غير مرتبطة بتدفق Stripe الحالي:

```text
API_REFERENCE.docx
API_REFERENCE.md
docs/NOTIFICATIONS_AUDIT_ISSUES.md
```

كما توجد تعديلات في جزء Reviews داخل:

```text
src/controllers/users.js
```

وهي ليست جزءًا من تغيير Stripe/Seller الموثق هنا.

يجب مراجعة نطاق commit بعناية وعدم افتراض أن كل ملف Dirty يعود لهذا العمل.

## 31. خلاصة قبل وبعد

### قبل

```text
Stripe account exists = seller may proceed
success true = assumed ready
no pending verification state
no hosted onboarding endpoint
seller application mixed with bank/KYC
weak financial route ownership checks
auction errors lose provider details
bid values may become inconsistent
```

### بعد

```text
Seller application is separate from Stripe
Admin approval is separate from KYC approval
Stripe account creation is idempotent
Stripe live status is the source of truth
Hosted onboarding collects current and future requirements
Pending verification has a dedicated state
Restricted sellers are blocked server-side
Financial routes verify account ownership
Sensitive logging is reduced
Auction payment errors are structured
Bid values are numeric and synchronized
Automated status tests cover main edge cases
```

## 32. ملحق تغييرات النشر إلى DigitalOcean

هذه التغييرات تشغيلية وليست جزءًا من منطق Stripe، لكنها حدثت ضمن نفس دورة العمل.

Commits:

```text
633018e Deploy backend using app PM2 process
d45a831 Deploy backend files directly to server
```

### وضع PM2 قبل التعديل

كان السيرفر يشغّل عمليتين لنفس ملف Backend:

```text
app
tokshop-api
```

وكلتاهما كانتا تشغّلان:

```text
/var/www/tokshop-backend/app.js
```

هذا كان يسبب:

- غموض حول أي process يخدم الـAPI الفعلي.
- إعادة تشغيل process بينما الآخر يبقى على نسخة مختلفة.
- عدد Restarts مرتفع جدًا.
- احتمال أن تصل الطلبات إلى process لم يتم تحديثه.

تم حذف process المكرر من السيرفر:

```text
tokshop-api
```

وتم اعتماد:

```text
app
```

ثم حفظ قائمة PM2:

```text
pm2 save
```

هذا الإجراء تم على السيرفر وليس تعديلًا داخل ملفات المشروع.

### GitHub Actions قبل التعديل

كانت عملية النشر تدخل إلى:

```text
/var/www/tokshop-backend
```

ثم تنفذ:

```text
git pull origin main
npm install --production
pm2 restart app
```

المشكلة:

- نسخة السيرفر كانت على branch محلي باسم `master`.
- `origin/main` كان يشير إلى commit مختلف.
- نجاح Workflow لم يكن يثبت بالضرورة أن Working Tree على السيرفر أصبح مساويًا للـcommit الجديد.
- `git log -1` بقي يعرض commit قديمًا رغم نجاح GitHub Action.

### GitHub Actions بعد التعديل

أصبحت العملية:

1. تعمل Checkout للـcommit الذي شغّل Workflow.
2. ترفع ملفات Backend مباشرة عبر SCP.
3. تثبت dependencies.
4. تعيد تشغيل `app`.
5. تحفظ SHA المنشور في `.deployed-commit`.

الملفات التي يتم رفعها:

```text
app.js
utils.js
package.json
src
```

الأوامر التشغيلية بعد الرفع:

```text
cd /var/www/tokshop-backend
npm install --production
pm2 restart app
echo "$DEPLOYED_COMMIT" > .deployed-commit
```

### التحقق من النسخة المنشورة

المرجع الصحيح بعد اعتماد الرفع المباشر:

```text
cat /var/www/tokshop-backend/.deployed-commit
```

يجب أن يساوي SHA الظاهر في GitHub Actions.

لم يعد:

```text
git log -1
```

مرجعًا موثوقًا للنسخة المنشورة، لأن الملفات يتم رفعها مباشرة ولا يتم تحديث Git checkout على السيرفر.

### أثر ذلك على تغييرات Stripe الحالية

الملف الجديد:

```text
src/shared/stripeAccountStatus.js
```

موجود داخل `src`، لذلك سيتم رفعه بواسطة Workflow بشرط إضافته إلى Git وPush.

ملف الاختبار:

```text
test/stripeAccountStatus.test.js
```

لا يتم رفعه حاليًا لأن `source` في Workflow لا يحتوي مجلد `test`.

هذا لا يمنع تشغيل الإنتاج، لكنه يعني أن اختبارات المشروع يجب تشغيلها في CI أو قبل Push، وليس على السيرفر باستخدام الملفات المرفوعة الحالية.

### تحذير GitHub Actions

ظهر تحذير بأن بعض Actions المبنية على Node.js 20 ستنتقل إلى Node.js 24.

هذا التحذير:

- لم يمنع Workflow من النجاح وقتها.
- يحتاج تحديث نسخ Actions مستقبلًا إذا صدر إصدار يدعم Node.js 24.
- لا يتعلق بمنطق Backend أو Stripe.

## 33. ملحق مراجعة الإشعارات

تم إنشاء:

```text
docs/NOTIFICATIONS_AUDIT_ISSUES.md
```

وظيفته تسجيل مشاكل وملاحظات نظام الإشعارات ليتم حلها لاحقًا.

هذا الملف:

- توثيقي فقط.
- لا يغير إرسال الإشعارات.
- لا يؤثر على Stripe أو Seller Eligibility.
- لم يتم اعتباره جزءًا من إصلاح Stripe الحالي.
