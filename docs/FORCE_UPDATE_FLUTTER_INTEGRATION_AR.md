# دليل ربط Force Update في تطبيق Flutter

## ملخص العقد

يجب على تطبيق Flutter استخدام endpoint العام التالي لفحص وجود تحديث إجباري:

```http
GET https://api.taraf.live/public/app-update
```

- لا يحتاج `Authorization` أو JWT.
- يمكن استدعاؤه بعد شاشة السبلاش وقبل تسجيل الدخول.
- لا تستخدم `GET /settings` لهذا الغرض؛ هذا المسار محمي ويحتوي إعدادات إدارية.
- الاستجابة الناجحة دائماً `List`، وتكون إعدادات التحديث في أول عنصر.
- لا يعيد المسار العام أي مفاتيح أو إعدادات حساسة.

## شكل الاستجابة الناجحة

```json
[
  {
    "forceUpdate": true,
    "androidVersion": "5",
    "iosVersion": "5",
    "android_link": "https://play.google.com/store/apps/details?id=com.tokshop.liveApp",
    "ios_link": "https://apps.apple.com/us/app/stealz/id6759389642"
  }
]
```

## معنى الحقول

| الحقل | النوع | المعنى |
|---|---|---|
| `forceUpdate` | `bool` | يسمح بعرض شاشة التحديث الإجباري عند وجود Build أحدث |
| `androidVersion` | `String` رقمي | أقل Android Build Number مسموح، مثل `"5"` |
| `iosVersion` | `String` رقمي | أقل iOS Build Number مسموح، مثل `"5"` |
| `android_link` | `String` | رابط التطبيق في Google Play |
| `ios_link` | `String` | رابط التطبيق في App Store |

في استجابة هذا الـAPI فقط، `androidVersion` و`iosVersion` يمثلان **Build Number**. داخلياً يحفظ الباك إند الأرقام في `androidBuildNumber` و`iosBuildNumber` حتى لا يغيّر معنى حقول الإصدار النصي القديمة أو يكسر `/themes`.

## منطق القرار المطلوب

1. استدعِ endpoint بدون أي Authentication headers.
2. تأكد أن الاستجابة List وغير فارغة.
3. اقرأ أول عنصر فقط.
4. اختر `androidVersion` على Android و`iosVersion` على iOS.
5. حوّل Build Number الحالي من `PackageInfo.buildNumber` إلى `int`.
6. حوّل Build Number المطلوب من API إلى `int` باستخدام `int.tryParse`.
7. اعرض التحديث الإجباري فقط عندما:

```text
forceUpdate == true
AND requiredBuild صالح وأكبر من صفر
AND currentBuild < requiredBuild
AND رابط المتجر غير فارغ
```

لا تقارن `version` مثل `1.0.6`، ولا تستخدم مقارنة Strings.

## نموذج Dart مقترح

```dart
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'dart:convert';

class ForceUpdateResult {
  const ForceUpdateResult({
    required this.mustUpdate,
    required this.updateUrl,
  });

  final bool mustUpdate;
  final String updateUrl;
}

Future<ForceUpdateResult> checkForceUpdate() async {
  try {
    final response = await http
        .get(Uri.parse('https://api.taraf.live/public/app-update'))
        .timeout(const Duration(seconds: 10));

    if (response.statusCode != 200) {
      return const ForceUpdateResult(mustUpdate: false, updateUrl: '');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List || decoded.isEmpty || decoded.first is! Map) {
      return const ForceUpdateResult(mustUpdate: false, updateUrl: '');
    }

    final settings = Map<String, dynamic>.from(decoded.first as Map);
    final packageInfo = await PackageInfo.fromPlatform();
    final currentBuild = int.tryParse(packageInfo.buildNumber);

    final requiredBuildRaw =
        Platform.isAndroid
            ? settings['androidVersion']
            : settings['iosVersion'];
    final updateUrlRaw =
        Platform.isAndroid
            ? settings['android_link']
            : settings['ios_link'];
    final updateUrl =
        updateUrlRaw is String ? updateUrlRaw.trim() : '';

    final requiredBuild = int.tryParse(requiredBuildRaw?.toString() ?? '');
    final forceUpdate = settings['forceUpdate'] == true;
    final validUrl = updateUrl.isNotEmpty;

    final mustUpdate =
        forceUpdate &&
        currentBuild != null &&
        requiredBuild != null &&
        requiredBuild > 0 &&
        currentBuild < requiredBuild &&
        validUrl;

    return ForceUpdateResult(
      mustUpdate: mustUpdate,
      updateUrl: updateUrl,
    );
  } catch (_) {
    // Fail open: لا تمنع المستخدم من فتح التطبيق بسبب مشكلة شبكة أو API.
    return const ForceUpdateResult(mustUpdate: false, updateUrl: '');
  }
}
```

## عرض شاشة التحديث

- إذا كانت `mustUpdate == true`، اعرض شاشة أو Dialog غير قابل للإغلاق.
- زر التحديث يفتح `updateUrl` باستخدام `url_launcher`.
- لا تعرض زر تخطي أو زر إغلاق في حالة التحديث الإجباري.
- لا تمنع تشغيل التطبيق عند timeout، خطأ شبكة، استجابة فارغة، أو Build Number غير صالح.

## أمثلة القرار

| Build الحالي | Build المطلوب | `forceUpdate` | النتيجة |
|---:|---:|---|---|
| 3 | 5 | `true` | عرض التحديث الإجباري |
| 5 | 5 | `true` | متابعة فتح التطبيق |
| 6 | 5 | `true` | متابعة فتح التطبيق |
| 3 | 5 | `false` | متابعة فتح التطبيق |
| 3 | قيمة غير رقمية | `true` | متابعة فتح التطبيق وتسجيل خطأ |

## ملاحظة تشغيلية للباك إند

القيم القديمة `androidVersion` و`iosVersion` تبقى كما هي، مثل `"1.0.6"`، ولن تتأثر. بعد نشر الباك إند يجب حفظ أرقام البناء الفعلية في:

```json
{
  "androidBuildNumber": "5",
  "iosBuildNumber": "5"
}
```

إذا لم تُضبط الحقول الجديدة، يعيد الـAPI `"0"` عند وجود إصدار نصي قديم، وبالتالي لا يفرض تحديثاً بالخطأ. وإذا كانت القيمة القديمة رقماً فقط، يستخدمها كتوافق مؤقت.

يمكن تهيئة أرقام البناء من لوحة الإدارة بعد إضافة الحقلين إليها، أو عبر طلب `POST /settings` المحمي للمشرف:

```json
{
  "androidBuildNumber": "5",
  "iosBuildNumber": "5"
}
```

لا ترسل `"1.0.6"` داخل حقول Build Number الجديدة. يمكن إبقاء `forceUpdate` بقيمة `false` أثناء التهيئة والاختبار، ثم تفعيله بعد التأكد من الاستجابة.

## مهمة جاهزة لمبرمج Flutter AI

```text
عدّل فحص Force Update في تطبيق Flutter ليستخدم:
GET https://api.taraf.live/public/app-update

الشروط:
- الطلب عام ولا يرسل Authorization أو JWT.
- الاستجابة List، واقرأ أول عنصر فقط بعد التحقق أن القائمة غير فارغة.
- استخدم PackageInfo.buildNumber كرقم البناء الحالي.
- على Android استخدم androidVersion وandroid_link.
- على iOS استخدم iosVersion وios_link.
- حوّل أرقام البناء باستخدام int.tryParse، ولا تقارن version النصي مثل 1.0.6.
- اعرض تحديثاً إجبارياً غير قابل للإغلاق فقط عندما:
  forceUpdate == true && currentBuild < requiredBuild && requiredBuild > 0.
- عند timeout أو خطأ API أو بيانات غير صالحة، سجّل الخطأ واسمح بفتح التطبيق.
- افتح رابط المتجر باستخدام url_launcher.
- أضف logs توضح platform وcurrentBuild وrequiredBuild وforceUpdate وupdateUrl وسبب القرار.
```
