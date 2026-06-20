# تقرير Backend لصفحات المشاركة وDeep Links وReferral

## A. هل كانت endpoints الحالية كافية؟

لا. بعض المسارات الحالية تستطيع جلب الكيانات، لكنها إما محمية بالمصادقة أو تعيد مستندات واسعة قد تحتوي بيانات حساسة. تمت إضافة endpoints JSON مستقلة للمشاركة، دون تغيير عقود endpoints المستخدمة في التطبيق ودون إنشاء redirects أو صفحات HTML جديدة.

## B. الملفات المعدلة

- `src/controllers/publicShare.js`
- `src/routes/publicShare.js`
- `src/shared/publicShare.js`
- `src/services/publicShare.middleware.js`
- `src/routes/ROUTE_MOUNTER.js`
- `src/shared/referral.js`
- `src/controllers/auth.js`
- `src/models/referral_log.js`
- `src/controllers/orders.js`
- `src/shared/functions.js`
- `test/publicShare.test.js`
- `test/referral.test.js`

لم يتم تعديل `assetlinks.json` أو `apple-app-site-association`.

## C. عقد endpoints

جميع المسارات عامة ولا تحتاج authentication:

- `GET /share/live/:id`
- `GET /share/product/:id`
- `GET /share/profile/:id`
- `GET /share/auction/:id`
- `GET /share/giveaway/:id`
- `GET /share/invite/:id`

الاستجابة الناجحة موحدة:

```json
{
  "type": "product",
  "id": "mongo-object-id",
  "title": "Public title",
  "description": "Short sanitized description",
  "image": "https://public-image-url",
  "url": "https://stealz.live/product/mongo-object-id",
  "appUrl": "stealz://product/mongo-object-id"
}
```

- ID غير صالح: `400`.
- عنصر غير موجود أو خاص أو محذوف أو حساب محظور: `404`.
- تجاوز rate limit: `429`.
- Cache: `public, max-age=60, stale-while-revalidate=300`.
- CORS يسمح صراحةً بأصل `https://stealz.live` على مسارات المشاركة.
- مسار المزاد يقبل auction ID أو product ID المرتبط بالمزاد.

## D. الحقول الحساسة الممنوعة

الـ queries تستخدم `select` محدوداً، والاستجابة يعاد بناؤها من الصفر. لا يتم إرجاع البريد، الهاتف، العنوان، وسائل الدفع، Stripe، tokens، الشحن، المشاركين، الفائز، bids، أو أي مستند كامل.

## E. نتيجة فحص referral

العقد يقبل الآن:

```json
{ "referrer": "inviter-user-id" }
```

ويقبل `referredBy` مؤقتاً للتوافق القديم. يتم التحقق من الداعي على الخادم، ورفض الداعي غير الصالح أو المحظور، ورفض self-referral، ومنع إعادة استخدام البريد/IP أو مكافأة نفس المستخدم مرتين. لا يتم الوثوق بـ `clientIp` أو قيمة الخصم القادمة من التطبيق.

لا تُمنح المكافأة عند فتح رابط الدعوة أو عند التسجيل. قيمة الخصم وحدّه تؤخذ من `referral_credit` و`referral_credit_limit` في إعدادات الخادم، وتطبق فقط عند أول دفع ناجح مؤهل.

## F. الاختبارات

- عنصر مشاركة موجود.
- ID غير صالح.
- منتج محذوف وبث خاص يعيدان `404`.
- منع تسريب الحقول الحساسة.
- تنظيف النصوص.
- قبول صور HTTPS العامة ورفض HTTP.
- صحة `url` و`appUrl`.
- قبول `referrer` والتوافق مع `referredBy`.
- رفض referrer غير صالح وself-referral وتكرار IP/email.

## G. المطلوب في مشروع الويب

- إنشاء الصفحات العامة: `/live/:id`, `/product/:id`, `/profile/:id`, `/auction/:id`, `/giveaway/:id`, `/invite/:userId`.
- استدعاء endpoint المقابل لتوليد Open Graph وTwitter metadata.
- إعداد `assetlinks.json` و`apple-app-site-association` على `stealz.live`.
- إعداد fallback للمتجر/التطبيق عند عدم فتح Deep Link.
- تمرير `referrer` إلى عقد التسجيل فقط بعد أن يقرر المستخدم التسجيل؛ فتح الرابط وحده لا يمنح مكافأة.
