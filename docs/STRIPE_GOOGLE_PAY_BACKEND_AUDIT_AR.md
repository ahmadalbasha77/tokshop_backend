# تدقيق تكامل Stripe وGoogle Pay في الـ Backend

> **نوع التدقيق:** قراءة فقط، دون تعديل ملفات المصدر  
> **Base URL:** `https://api.taraf.live`  
> **تاريخ التدقيق:** 14 يونيو 2026  
> **المسارات الأساسية:** `POST /stripe/setupitent` و`POST /stripe/savepaymentmethod`

## A. النتيجة النهائية

**غير جاهز للإنتاج.**

التدفق قد يعمل في حالة محدودة، لكنه لا يثبت ملكية المستخدم للـ Stripe Customer أو PaymentMethod، وقد يسرّب Stripe secret key، ولا يربط حفظ البطاقة بـ SetupIntent محدد. كذلك مسار إنشاء الطلبات متاح دون مصادقة بسبب ترتيب الـ routes ويثق بقيم مالية وهوية مشتري قادمة من التطبيق.

| المحور | الحكم | السبب المختصر |
|---|---|---|
| SetupIntent | غير جاهز | ينشئ Customer جديداً في كل طلب، دون حفظ الملكية أو إعادة `setupIntentId`. |
| حفظ PaymentMethod | غير موثوق | يسرد جميع البطاقات ويختار أول وسيلة جديدة دون ربطها بالـ SetupIntent الحالي. |
| الأمان | حرج | يثق بـ `userid` و`customer_id` ويسرّب إعدادات Stripe عبر `/settings`. |
| الشراء | غير آمن | مسار الطلبات متاح دون JWT ويثق بالمبلغ والمشتري من request body. |
| Stripe Connect | متوافق جزئياً | الدفع على المنصة ثم Transfers؛ الوسيلة تعمل فقط إذا حُفظت بصورة صحيحة. |
| Webhooks | ناقص | التوقيع صحيح، لكن أحداث الدفع والإعداد والنزاعات غير معالجة. |
| Google Pay | لا يحتاج endpoint خاصاً | الخلل في حفظ الوسيلة والملكية والشراء، وليس في Google Pay نفسه. |

## 1. خريطة الملفات والتدفق

### مسارات Stripe

- Route: `src/routes/stripe.js:18-21`
- Controller: `src/controllers/stripe.js:1127-1255`
- لا توجد Stripe service مستقلة للمسارين؛ الاستدعاءات المباشرة موجودة في controller.
- تركيب المسارات والمصادقة: `src/routes/ROUTE_MOUNTER.js:112-114`

### إعدادات Stripe

- Model: `src/models/settings.js:64-99` و`132-135`
- Controller: `src/controllers/settings.js:44-115`
- Routes: `src/routes/settings.js:4-6`
- Helper المستخدم داخلياً: `src/shared/functions.js:1468-1471`

### قاعدة البيانات

- وسائل الدفع: `src/models/payment_methods.js:9-70`
- default payment method للمستخدم: `src/models/user.js:92-96`
- لا يوجد حقل واضح مخصص لحفظ Stripe Customer ID على المستخدم.

### الشراء والـ Webhooks

- Order route: `src/routes/order.js:5`
- Order controller: `src/controllers/orders.js:1112-1268`
- إنشاء الطلب والدفع: `src/shared/functions.js:158-508`
- إنشاء PaymentIntent: `src/shared/functions.js:855-1015`
- تحويل أرباح البائع: `src/shared/orderPaymentRelease.js:38-197`
- Webhook routes: `src/routes/webhook.js:4-15`
- Webhook controller: `src/controllers/webhookController.js:14-393`
- Raw body mounting: `app.js:14-17`

## B. المشاكل الحرجة

### 2. تسريب وإمكانية تعديل Stripe secret key

**الملفات والأسطر:**

- `src/controllers/settings.js:44-49`
- `src/controllers/settings.js:87-107`
- `src/models/settings.js:88-99`
- `src/models/settings.js:132-135`
- `src/routes/ROUTE_MOUNTER.js:120-122`
- `src/routes/settings.js:4-6`

**الكود الحالي:**

```js
const settings = await AppSettingsSchema.find();
return res.status(200).json(settings);
```

وعند الحفظ:

```js
const updates = getAllowedUpdates(req.body);
const settings = await AppSettingsSchema.findOneAndUpdate(...);
return res.status(200).json(settings);
```

**لماذا هو خطأ؟**

`getAppSettings` يعيد وثيقة الإعدادات كاملة، والـ schema يحتوي:

- `stripeSecretKey`
- `stripe_webhook_key`
- `stripe_platform_webhook_key`
- مفاتيح وخدمات حساسة أخرى

المسار محمي بـ JWT مستخدم عادي فقط، وليس بصلاحية admin. كما يستطيع المستخدم المصادق استدعاء `POST /settings` لتغيير جميع حقول الـ schema.

**التأثير:**

- قراءة مفتاح Stripe السري من Flutter أو أي مستخدم يملك JWT.
- تنفيذ عمليات Stripe مباشرة خارج الخادم.
- تغيير مفتاح Stripe أو webhook secrets وتعطيل أو اختطاف الدفع.

**التصحيح المطلوب:**

1. قصر قراءة وتعديل الإعدادات الكاملة على admin.
2. إنشاء response عام يحتوي allowlist للحقول غير الحساسة فقط.
3. عدم إعادة أي secret أو webhook secret في أي API response.

### 3. انتحال المستخدم والـ Customer في `savepaymentmethod`

**الملف والأسطر:** `src/controllers/stripe.js:1149-1241`

```js
let { customer_id, userid, methodid } = req.body;
```

ثم:

```js
const existingPaymentMethods = await paymentmethodModel.find({
  userid: userid,
  customerid: customer_id
});
```

ويحدث مستخدم body مباشرة:

```js
await userModel.findByIdAndUpdate(userid, {
  $set: { defaultpaymentmethod: firstNewMethod._id }
});
```

**لماذا هو خطأ؟**

الـ endpoint لا يستخدم `req.user`، ويثق بـ `userid` و`customer_id` القادمين من التطبيق.

**التأثير:**

- مستخدم مصادق يستطيع إضافة وسيلة دفع لمستخدم آخر.
- يستطيع تغيير default payment method لمستخدم آخر.
- يستطيع ربط Stripe Customer لا يملكه بسجل مستخدم آخر.

**التصحيح المطلوب:**

- استخراج user ID من `req.user._id` فقط.
- عدم استقبال `userid` من Flutter.
- تخزين Stripe Customer ID على المستخدم.
- التأكد أن `customer_id` يساوي Customer المسجل للمستخدم الحالي.

### 4. `setupitent` ينشئ Customer جديداً لكل طلب

**الملف والأسطر:** `src/controllers/stripe.js:1127-1144`

```js
async function createCustomer(email, stripe) {
  const customer = await stripe.customers.create({
    email: email,
  });
  return customer.id;
}
```

ثم:

```js
let customer_id = await createCustomer(email, stripe);
```

**المشاكل:**

- لا يستخدم `req.user`.
- يعتمد على email من التطبيق.
- لا يبحث عن Customer موجود.
- ينشئ Customer جديداً دائماً.
- لا يحفظ Customer ID في قاعدة البيانات.
- البريد لا يثبت ملكية المستخدم.

**التأثير:** Customers مكررة، وفقدان العلاقة الدائمة بين المستخدم وStripe Customer، وعدم القدرة على التحقق من الملكية في `savepaymentmethod`.

**التصحيح المطلوب:**

1. قراءة المستخدم من JWT.
2. إعادة استخدام `stripeCustomerId` المخزن.
3. إنشاء Customer فقط إذا لم يوجد.
4. إضافة `metadata.userId`.
5. حفظ Customer ID على المستخدم.

### 5. إعداد SetupIntent ناقص

**الملف والأسطر:** `src/controllers/stripe.js:1139-1144`

```js
let payload = {
  customer: customer_id,
  payment_method_types: ["card"],
};

const setupIntent = await stripe.setupIntents.create(payload);
res.json({ clientSecret: setupIntent.client_secret, customer_id });
```

**الصحيح:**

- مربوط بـ Customer.
- يسمح بـ `card`، وهو مناسب لـ Google Pay.
- يعيد `clientSecret` و`customer_id` بالشكل الذي يتوقعه Flutter.
- ينشأ على Platform account.

**الناقص:**

- لا يحدد `usage: "off_session"` صراحة.
- لا يعيد `setupIntentId`.
- لا يضيف metadata للمستخدم.
- لا يحفظ Customer في قاعدة البيانات.

**الشكل المستهدف:**

```js
const setupIntent = await stripe.setupIntents.create({
  customer: customerId,
  payment_method_types: ["card"],
  usage: "off_session",
  metadata: {
    userId: req.user._id.toString(),
  },
});

return {
  clientSecret: setupIntent.client_secret,
  customer_id: customerId,
  setupIntentId: setupIntent.id,
};
```

### 6. `methodid=null` لا يحدد PaymentMethod الناتج

**الملف والأسطر:** `src/controllers/stripe.js:1154-1235`

المسار يسرد جميع بطاقات Customer:

```js
const paymentMethods = await stripe.paymentMethods.list({
  customer: customer_id,
  type: "card",
});
```

ثم يحفظ كل بطاقة غير موجودة محلياً ويختار أول وسيلة جديدة:

```js
const firstNewMethod = newPaymentMethods[0];
```

أما `methodid` فيستخدم فقط هنا:

```js
await paymentmethodModel.findByIdAndDelete(methodid);
```

**الحكم: `methodid=null` لا يعمل بصورة موثوقة.**

قد ينجح عرضياً إذا كان Customer جديداً ولا يملك إلا PaymentMethod واحدة، لكن:

- لا يستقبل `setupIntentId`.
- لا يسترجع SetupIntent.
- لا يقرأ `setupIntent.payment_method`.
- قد يحفظ بطاقة قديمة غير موجودة محلياً.
- قد يختار بطاقة خاطئة عند وجود أكثر من وسيلة جديدة.
- يتأثر بالطلبات المتزامنة.

**التصحيح المطلوب:**

```js
const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

if (setupIntent.status !== "succeeded") {
  // reject
}

if (setupIntent.customer !== currentUser.stripeCustomerId) {
  // reject
}

const paymentMethodId = setupIntent.payment_method;
```

### 7. إنشاء سجل وسيلة الدفع والـ default

**الملف والأسطر:** `src/controllers/stripe.js:1195-1243`

الكود ينشئ سجلاً محلياً يحتوي PaymentMethod ID وCustomer ID وآخر أربعة أرقام والانتهاء والمستخدم ونوع المحفظة. ثم يجعل أول وسيلة جديدة `primary` ويحدث `user.defaultpaymentmethod`.

هذا default محلي فقط. لا يوجد:

```js
stripe.customers.update(customerId, {
  invoice_settings: {
    default_payment_method: paymentMethodId,
  },
});
```

كذلك `setDefaultPaymentMethod` في `src/controllers/stripe.js:1277-1314` يحدث MongoDB فقط ويثق بـ `userid` القادم من التطبيق.

### 8. مسار إنشاء الطلب متاح دون مصادقة

**الملف والأسطر:** `src/routes/ROUTE_MOUNTER.js:97-100`

```js
router.use("/orders", orderRouter);

router.use(
  "/orders",
  passport.authenticate("jwt", { session: false }),
  orderRouter
);
```

أول mount متاح دون JWT، ولذلك `POST /orders/:userId` يمكن أن ينفذ من المسار العام.

**التأثير:**

- إنشاء محاولات شراء دون مصادقة.
- الوصول إلى مسارات قراءة وتعديل وإلغاء طلبات دون حماية موحدة.

**التصحيح المطلوب:** إزالة mount العام، أو فصل المسارات العامة الحقيقية في Router مستقل.

### 9. الخادم يثق بالمبلغ وهوية المشتري من Flutter

**الملف والأسطر:** `src/controllers/orders.js:1112-1169`

```js
const {
  buyer,
  product,
  quantity,
  subtotal,
  tax,
  seller,
  shippingFee,
  referralDiscount,
} = req.body;
```

هذه القيم تمر إلى `functions.createOrder`.

**المشاكل:**

- `buyer` مأخوذ من التطبيق بدلاً من JWT.
- `seller` مأخوذ من التطبيق.
- `subtotal` مأخوذ من التطبيق.
- `tax` مأخوذ من التطبيق.
- `shippingFee` والخصم مأخوذان من التطبيق.

**التأثير:** انتحال المشتري، تخفيض المبلغ، والتلاعب بالضريبة والشحن والخصم والبائع.

**التصحيح المطلوب:**

- استخدام `req.user._id` للمشتري.
- جلب المنتج والبائع والسعر من قاعدة البيانات.
- حساب الضريبة والشحن والخصومات في الخادم.

### 10. مسار PaymentIntent الفعلي

**الملف والأسطر:** `src/shared/functions.js:855-959`

قبل الدفع يتحقق الكود أن PaymentMethod مرتبطة بالـ Customer:

```js
const stripePaymentMethod =
  await stripe.paymentMethods.retrieve(paymentmethod.paymentMethodId);

if (stripePaymentMethod.customer !== paymentmethod.customerid) {
  throw new Error("PAYMENT_METHOD_CUSTOMER_MISMATCH");
}
```

ثم ينشئ PaymentIntent:

```js
const paymentIntent = await stripe.paymentIntents.create({
  amount: totalChargeCents,
  currency: "usd",
  customer: paymentmethod.customerid,
  payment_method: paymentmethod.paymentMethodId,
  off_session: true,
  confirm: true,
  transfer_group: `order_${orderId}`,
  metadata: {
    sellerId: sellerdata._id.toString(),
    orderId: orderId.toString(),
  },
  on_behalf_of: sellerdata.stripe_account,
});
```

**الصحيح:**

- يستخدم Customer وPaymentMethod صراحة.
- يستخدم `off_session: true`.
- يستخدم `confirm: true`.
- يحول المبلغ إلى cents في الخادم.
- يتحقق من ارتباط PaymentMethod بالـ Customer.

**المشاكل:**

- أصل المبلغ غير موثوق لأنه جاء من Flutter.
- لا يوجد idempotency key لإنشاء PaymentIntent.
- لا يوجد فحص صريح أن `refreshedPI.status === "succeeded"`.
- لا توجد معالجة مخصصة لـ `requires_action` أو `authentication_required`.
- أي نتيجة لا ترمي exception تعاد كـ `success: true`.

### 11. هل يمنع إنشاء Order مدفوع قبل نجاح PaymentIntent؟

الدفع ينفذ قبل إنشاء Order ناجح:

- محاولة الدفع: `src/shared/functions.js:281-293`
- عند الفشل يعود `success: false`.
- عند النجاح المفترض ينشئ Item وOrder في `src/shared/functions.js:449-490`.

هذا أفضل من إنشاء Order مدفوع قبل محاولة الدفع، لكن النجاح يعتمد على عدم رمي Stripe خطأ فقط، وليس على:

```js
paymentIntent.status === "succeeded"
```

كما أن النظام لا يعتمد على `payment_intent.succeeded` Webhook كمصدر حقيقة.

## 12. Stripe Connect

### أين ينشأ SetupIntent؟

على **Platform account**؛ لا يوجد `Stripe-Account` header ولا:

```js
{ stripeAccount: connectedAccountId }
```

### أين ينشأ PaymentIntent؟

على **Platform account** أيضاً، باستخدام نفس `stripeSecretKey`.

### نوع التدفق المالي

التدفق أقرب إلى **Separate charges and transfers**:

1. PaymentIntent ينشأ على المنصة.
2. يحتوي `on_behalf_of` للبائع.
3. لا يستخدم `transfer_data.destination`.
4. لا ينشأ كـ direct charge على Connected Account.
5. تحويل أرباح البائع ينفذ لاحقاً في `src/shared/orderPaymentRelease.js:131-139`.

```js
const transfer = await stripe.transfers.create({
  amount: Math.round(netAmount * 100),
  currency: "usd",
  destination: seller.stripe_account,
  transfer_group: ...,
});
```

### هل يوجد تعارض account scope؟

لا يوجد تعارض مباشر في التصميم الحالي، لأن Customer وSetupIntent وPaymentMethod وPaymentIntent كلها على المنصة.

كان سيظهر التعارض لو أن PaymentIntent ينشأ كـ direct charge باستخدام `stripeAccount` على حساب البائع، لأن PaymentMethod المنصة لا تكون متاحة تلقائياً على Connected Account.

## 13. Test/Live Mode

### ما يمكن إثباته من Backend

- setup وsave وPaymentIntent تستخدم نفس `stripeSecretKey`.
- Customer وSetupIntent وPaymentMethod والدفعة تنشأ على نفس Stripe account والمفتاح.

### ما لا يمكن إثباته

لا يمكن تأكيد أن publishable key المستخدم في Flutter من نفس الوضع، لأن كود Flutter وقيم بيئة الإنتاج غير موجودة في هذا المستودع.

### `demoMode`

يوجد تحقق محدود في `src/shared/functions.js:1564-1572` يمنع `demoMode === true` مع مفتاح يبدأ بـ `sk_live_` أثناء إنشاء حساب بائع.

لكنه لا يغطي:

- `setupitent`
- `savepaymentmethod`
- PaymentIntent
- تطابق `stripepublickey` مع `stripeSecretKey`

`demoMode` لا يحدد Stripe mode الحقيقي؛ الوضع الحقيقي تحدده المفاتيح والحساب.

## 14. Webhooks

### الأشياء الصحيحة

- `app.js:16-17` يركب Webhook قبل JSON middleware باستخدام raw body.
- `src/controllers/webhookController.js:20-24` يتحقق من `stripe-signature`.
- يوجد secret منفصل للـ platform webhook.

### الأحداث

| الحدث | الحالة | الملاحظة |
|---|---|---|
| `setup_intent.succeeded` | غير موجود | لا حفظ موثوق للوسيلة أو ربطها بالمستخدم. |
| `setup_intent.setup_failed` | غير موجود | لا مزامنة لفشل إعداد الوسيلة. |
| `payment_intent.succeeded` | غير موجود | الطلب لا يعتمد على Webhook لتأكيد الدفع. |
| `payment_intent.payment_failed` | غير موجود | لا تسوية للفشل غير المتزامن. |
| `charge.refunded` | موجود جزئياً | يحدث Transaction حسب `chargeId`. |
| `charge.dispute.created` | غير موجود | لا تجميد أو تسجيل للنزاع. |
| `account.updated` | موجود | يزامن حالة Connected Account. |
| `payout.paid` | موجود | يحدث payout transaction والمحفظة. |

### Idempotency

لا يتم تخزين `event.id` لمنع إعادة معالجة Webhook.

توجد idempotency keys لبعض Transfers في:

- `src/shared/orderPaymentRelease.js:127-139`
- `src/controllers/webhookController.js:321-324`

لكنها لا تحمي Webhook handlers عموماً، ولا إنشاء PaymentIntent.

## 15. Logs وValidation وRate Limiting

### Logs

`src/shared/functions.js:980-1012`:

```js
console.error("Stripe original error:", err);
console.error("Stripe payment failed", {
  providerResponse: err.raw,
});
```

قد يحتوي `err.raw` على PaymentIntent وبيانات Stripe حساسة أو `client_secret` حسب نوع الخطأ.

كذلك يوجد في `app.js:91-97`:

```js
console.log("RAW TOKEN:", authHeader);
```

هذا middleware مركب بعد routes وقد لا يعمل لمعظم الطلبات المكتملة، لكن وجود طباعة Authorization header يظل خطراً.

### Validation

لا يوجد validation schema صريح لـ email أو Customer ID أو SetupIntent ID أو الملكية.

### Rate limiting

لا توجد مكتبة rate limiting في `package.json` ولا middleware واضح للمسارين.

## C. الأشياء الصحيحة الموجودة حالياً

- `/stripe/*` محمي بـ JWT على مستوى route mount.
- SetupIntent يستخدم `payment_method_types: ["card"]`.
- `card` مناسب لـ Google Pay عبر Stripe.
- SetupIntent وsave وPaymentIntent تستخدم نفس secret key.
- PaymentIntent يستخدم Customer وPaymentMethod المحفوظين.
- يتم التحقق من أن PaymentMethod مرتبطة بالـ Customer قبل الدفع.
- يستخدم `off_session: true` و`confirm: true`.
- الدفع والحفظ كلاهما على Platform account.
- تدفق Connect الحالي لا يستخدم direct charges.
- Webhooks تتحقق من التوقيع.
- تحويلات أرباح البائع تستخدم idempotency key.

## D. العقد الفعلي لكل Endpoint

### `POST /stripe/setupitent`

**Request:**

```json
{
  "email": "user@example.com"
}
```

**Authentication:** JWT مطلوب، لكن المستخدم المصادق لا يستخدم داخل controller.

**Stripe objects:**

1. Customer جديد دائماً.
2. SetupIntent مرتبط بالـ Customer.

**Response:**

```json
{
  "clientSecret": "seti_..._secret_...",
  "customer_id": "cus_..."
}
```

لا يعيد `setupIntentId` ولا يحفظ Customer ID في قاعدة البيانات.

### `POST /stripe/savepaymentmethod`

**Request:**

```json
{
  "customer_id": "cus_...",
  "methodid": null,
  "userid": "firebase-user-id"
}
```

**Authentication:** JWT مطلوب، لكن الملكية تحدد من body.

**Stripe operation:**

```js
stripe.paymentMethods.list({
  customer: customer_id,
  type: "card",
});
```

لا يستخدم SetupIntent.

**Database:**

- ينشئ سجلات وسائل دفع.
- يجعل أول وسيلة جديدة primary.
- يحدث `user.defaultpaymentmethod`.
- لا يحدث Stripe `invoice_settings.default_payment_method`.

**Response:** يعيد Stripe PaymentMethods list كاملة.

```js
return res.json(paymentMethods);
```

## E. هل `methodid=null` يعمل فعلاً؟

**لا، ليس بصورة موثوقة.**

الدليل:

- `methodid` لا يستخدم لمعرفة Stripe PaymentMethod.
- لا يستقبل `setupIntentId`.
- لا يسترجع SetupIntent.
- يجلب جميع بطاقات Customer.
- يختار `newPaymentMethods[0]`.

يمكن أن ينجح عرضياً فقط إذا كانت هناك وسيلة واحدة جديدة لا غير.

## F. هل Stripe secret key يتسرب إلى التطبيق؟

**نعم. ثغرة حرجة.**

الدليل:

- `src/models/settings.js:88-99`
- `src/controllers/settings.js:44-49`
- `src/routes/settings.js:4-6`
- `src/routes/ROUTE_MOUNTER.js:120-122`

أي مستخدم يحمل JWT يستطيع استدعاء `GET /settings` واستلام وثيقة الإعدادات التي تحتوي secret key وwebhook secrets.

## G. هل Google Pay المحفوظ قابل للاستخدام في شراء حقيقي؟

**لا، ليس بشكل موثوق حالياً.**

تقنياً، Google Pay عبر Stripe ينتج PaymentMethod من نوع `card`، ومسار PaymentIntent الحالي يستطيع شحن card PaymentMethod محفوظة على Platform Customer.

لكن التدفق الحالي لا يضمن:

- أن الوسيلة المحفوظة ناتجة عن SetupIntent الحالي.
- أن Customer تابع للمستخدم الحالي.
- أن userid غير منتحل.
- أن مبلغ الطلب محسوب في الخادم.
- أن الطلب محمي بـ JWT.
- أن نجاح الدفع مؤكد عبر Webhook.

### التتبع الفعلي

1. Flutter يرسل email إلى `/stripe/setupitent`.
2. Backend ينشئ Customer جديداً.
3. Backend ينشئ SetupIntent على المنصة.
4. Flutter ينفذ `confirmPlatformPaySetupIntent`.
5. Flutter يرسل `customer_id` و`userid` و`methodid=null`.
6. Backend يسرد كل بطاقات Customer.
7. Backend يحفظ كل وسيلة غير موجودة محلياً.
8. أول وسيلة جديدة تصبح primary.
9. عند الشراء، Backend يجلب primary method من MongoDB.
10. ينشئ PaymentIntent على المنصة.
11. يحول أرباح البائع لاحقاً إلى Connected Account.
12. Webhook لا يؤكد `payment_intent.succeeded`.

## هل يحتاج Google Pay كود Backend خاصاً؟

**لا يحتاج endpoint منفصلاً في هذا التصميم.**

Google Pay عبر Stripe ينتج PaymentMethod من نوع `card`. المطلوب هو SetupIntent صحيح، وCustomer مملوك للمستخدم، وحفظ PaymentMethod الناتجة تحديداً، واستخدام الحساب والوضع نفسيهما، وPaymentIntent آمن، وWebhooks موثوقة.

## H. قائمة التعديلات حسب الأولوية

| الأولوية | التعديل |
|---|---|
| P0 | إغلاق `GET/POST /settings` أمام المستخدمين وحماية الإعدادات بصلاحية admin. |
| P0 | إزالة mount العام لـ `/orders` وفرض JWT. |
| P0 | استخدام `req.user._id` بدلاً من `buyer` و`userid` القادمين من التطبيق. |
| P0 | حساب السعر والضريبة والشحن والخصومات في الخادم. |
| P0 | تخزين Stripe Customer ID على المستخدم والتحقق من ملكيته. |
| P1 | إعادة استخدام Customer بدلاً من إنشائه في كل SetupIntent. |
| P1 | إضافة `usage: "off_session"` وmetadata وإرجاع `setupIntentId`. |
| P1 | جعل save endpoint يستقبل `setupIntentId` ويسترجع SetupIntent. |
| P1 | حفظ `setupIntent.payment_method` فقط. |
| P1 | تحديث `customer.invoice_settings.default_payment_method`. |
| P1 | معالجة Webhooks الخاصة بالـ SetupIntent وPaymentIntent والنزاعات. |
| P1 | تخزين `event.id` لمنع تكرار معالجة Webhooks. |
| P1 | إضافة idempotency key لإنشاء PaymentIntent. |
| P2 | التحقق من تطابق `pk_test/sk_test` أو `pk_live/sk_live`. |
| P2 | فصل `demoMode` عن Stripe mode الحقيقي مع guardrails واضحة. |
| P2 | إضافة validation وrate limiting. |
| P2 | إزالة Stripe raw errors وJWT وclient secrets من السجلات. |
| P2 | إضافة اختبارات ownership والتزامن و`requires_action` والـ Webhooks. |

## عقد API مقترح بعد الإصلاح

### إنشاء SetupIntent

```http
POST /stripe/setupintent
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{}
```

```json
{
  "clientSecret": "seti_..._secret_...",
  "customer_id": "cus_...",
  "setupIntentId": "seti_..."
}
```

### حفظ PaymentMethod

```http
POST /stripe/savepaymentmethod
Authorization: Bearer <JWT>
Content-Type: application/json
```

```json
{
  "setupIntentId": "seti_..."
}
```

```json
{
  "success": true,
  "paymentMethodId": "pm_...",
  "type": "google_pay",
  "last4": "4242",
  "primary": true
}
```

## حدود التدقيق

- لم يتم استدعاء Stripe API الإنتاجي.
- لم تتم قراءة قاعدة بيانات الإنتاج.
- لم يتم الاطلاع على قيم المفاتيح الفعلية.
- لم يتوفر كود Flutter داخل هذا المستودع للتحقق من publishable key.
- لم يتم تعديل ملفات Backend ضمن هذا التدقيق.

## مراجع Stripe

- [SetupIntents API](https://docs.stripe.com/api/setup_intents/create)
- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Stripe Webhooks](https://docs.stripe.com/webhooks)
- [Google Pay with Stripe](https://docs.stripe.com/google-pay)
