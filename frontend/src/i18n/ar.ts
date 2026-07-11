// Arabic strings for the Today Cockpit. Centralized here (PR #10 rule:
// "i18n: centralized src/i18n/ar.ts / en.ts, no scattered strings") so
// no component ever contains a hard-coded user-facing string.
const ar = {
  appName: "HadeelOS",
  today: {
    title: "اليوم",
    loading: "جارٍ تحميل قرار اليوم…",
    retrying: "إعادة المحاولة…",
    offline: "أنت غير متصل بالإنترنت. سنعرض آخر بيانات معروفة إن وُجدت.",
    stale: "هذه البيانات ليست محدّثة. اسحبي للأسفل لإعادة التحميل.",
    applicationError: "حدث خطأ غير متوقع أثناء تحميل قرار اليوم.",
    retry: "إعادة المحاولة",
    empty: "لا توجد قرارات مرشّحة اليوم بعد.",
    missingSignals: "لا تتوفر إشارات كافية بعد لاتخاذ قرار واثق.",
    lowConfidence: "الثقة بهذا القرار منخفضة حاليًا.",
    uncertain: "النتائج متقاربة جدًا — لا يوجد خيار واضح بعد.",
    partialConnectorFailure: "تعذّر تحديث بعض المصادر (مثل التقويم أو البريد)، لكن بقية البيانات محدّثة.",
  },
  context: {
    heading: "لمحة سريعة",
    signalCount: "عدد الإشارات",
    missingSignals: "إشارات ناقصة",
    generatedAt: "آخر تحديث",
    graphVersion: "إصدار الرسم البياني المعرفي",
  },
  decision: {
    heading: "القرار المقترح",
    accept: "قبول",
    reject: "رفض",
    ignore: "تجاهل",
    accepted: "تم القبول",
    rejected: "تم الرفض",
    ignored: "تم التجاهل",
    recordOutcome: "تسجيل النتيجة",
    outcomeCompleted: "أُنجز",
    outcomeSkipped: "تم تخطّيه",
    outcomePartial: "أُنجز جزئيًا",
  },
  confidence: {
    heading: "الثقة",
    low: "منخفضة",
    moderate: "متوسطة",
    high: "عالية",
    very_high: "عالية جدًا",
  },
  why: {
    heading: "لماذا هذا القرار؟",
    empty: "لا تفسير متاح لهذا القرار بعد.",
  },
  alternatives: {
    heading: "بدائل أخرى",
    predictedSuccess: "احتمال النجاح",
    rejectionReason: "سبب الاستبعاد",
    empty: "لا توجد بدائل أخرى.",
  },
  forecast: {
    heading: "التوقع",
    completion: "الإنجاز",
    capacity: "القدرة",
    stress: "التوتر",
  },
  timeline: {
    heading: "الجدول الزمني",
    empty: "لا يوجد جدول زمني بعد.",
  },
  ifYouDoNothing: {
    heading: "إذا لم تفعلي شيئًا",
    highStress: "قد يرتفع التوتر ويقل الإنجاز المتوقع دون اتخاذ قرار.",
    default: "استمرار الوضع الحالي دون تغيير سيحافظ على المسار التوقعي الحالي.",
  },
  memory: {
    heading: "ما تعرفه HadeelOS عنكِ",
    empty: "لا توجد ذكريات محفوظة بعد.",
    state: {
      Missing: "غير معروف",
      Learning: "قيد التعلّم",
      Knows: "معروف",
    },
    correct: "تصحيح",
    forget: "نسيان",
    block: "حظر الاستدلال",
    blocked: "محظور",
    correctPrompt: "أدخلي القيمة الصحيحة",
    blockPrompt: "سبب الحظر",
  },
  language: {
    toggle: "English",
  },
  errors: {
    generic: "حدث خطأ ما. حاولي مرة أخرى.",
    unauthenticated: "الرجاء تسجيل الدخول.",
  },
};

export default ar;
export type TranslationShape = typeof ar;
