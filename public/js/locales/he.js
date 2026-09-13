"use strict";

// Hebrew translation of locales/en.js's Admin-panel strings (Story 1 of the
// multi-language roadmap -- see STATUS.md). AI-TRANSLATED, PENDING HUMAN
// REVIEW: this is the file a human corrects when a phrase reads wrong --
// edit the Hebrew text below directly (each line is a plain key/value pair,
// no code changes needed) and commit. tests/unit/test_i18n.js's key-parity
// check only verifies every English key has a Hebrew counterpart here; it
// can't judge translation quality, so a wrong-but-present translation is
// exactly what the product owner's own read-through catches, not this test.
//
// The {unit}/{unitPlural} tokens carry through as whatever English word the
// board's admin chose (Squad/Team/Person/...) embedded inside the Hebrew
// sentence -- translating the unit label itself is a separate, deeper
// feature this story doesn't attempt.
var LOCALE_HE = {
  "admin.language.heading": "שפה",
  "admin.language.betaBadge": "בטא",
  "admin.language.hint": "בחרו את שפת מסך הניהול. חלקים נוספים באפליקציה יתווספו בהמשך ככל שכיסוי התרגום יגדל.",

  "admin.boardSetup.heading": "הגדרות לוח",
  "admin.boardSetup.hint": "נהלו את מודל הסקר ואת רשימת הצוותים. שינויים כאן חלים על כל מי שצופה בלוח הזה.",
  "admin.boardSetup.editDimensions": "עריכת ממדים",
  "admin.boardSetup.templates": "תבניות",
  "admin.boardSetup.importCsv": "ייבוא CSV",
  "admin.boardSetup.exportCsv": "ייצוא CSV",

  "admin.teamSync.heading": "סנכרון צוות",
  "admin.teamSync.hint": "הלוח הזה מסתנכרן, בזמן אמת, עם כל מכשיר אחר שפותח את הקישור למטה — דרך אותו ריליי מוצפן ששיחות הרטרו כבר משתמשות בו. אף אחד בלי הקישור לא יכול לקרוא או לשנות אותו.",
  "admin.teamSync.notConnectedHint": "הסנכרון כבוי במכשיר הזה.",
  "admin.teamSync.connectedStatus": "מחובר — המכשיר הזה נשאר מסונכרן, בזמן אמת, עם כל מכשיר אחר שמשתמש בקישור הזה.",
  "admin.teamSync.startLink": "התחלת קישור צוות חדש",
  "admin.teamSync.linkLabel": "קישור צוות",
  "admin.teamSync.copy": "העתקה",
  "admin.teamSync.stopSyncing": "עצירת סנכרון",
  "admin.teamSync.joinHint": "יש לכם קישור צוות ממישהו בצוות? פתיחתו מתחברת אוטומטית — או הדביקו אותו כאן כדי להצטרף (או לעבור) לצוות שלו:",
  "admin.teamSync.joinPlaceholder": "הדביקו קישור צוות",
  "admin.teamSync.join": "הצטרפות",

  "admin.squads.heading": "צוותים",
  "admin.squads.hint": "הוסיפו, שנו שם או הסירו צוותים. הדירוגים שייכים לצוות, לא לשם הצוות — שינוי שם בטוח לביצוע ואינו משפיע על הנתונים.",
  "admin.squads.addButton": "+ הוספת {unit}",
  "admin.squads.nameAriaLabel": "שם {unit}",
  "admin.squads.removeTitle": "הסרת {unit}",
  "admin.squads.emptyList": "אין עדיין {unitPlural} — הוסיפו אחד למטה.",
  "admin.squads.confirmRemoveTitle": "להסיר {unit}?",
  "admin.squads.confirmRemoveMessage": "להסיר את “{name}”? הדירוגים שלו יימחקו יחד איתו.",
  "admin.squads.confirmRemoveButton": "הסרה",
  "admin.squads.untitledFallback": "{unit} ללא שם",
  "admin.squads.thisUnit": "ה-{unit} הזה",

  "admin.diagnostics.summary": "אבחון (זמני — לפתרון בעיות שמירה)",
  "admin.diagnostics.hint": "אם השמירה לא עובדת, פתחו כאן, נסו לדרג תא, ואז העתיקו או צלמו מסך של מה שמופיע למטה.",
  "admin.diagnostics.copyButton": "העתקת אבחון"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOCALE_HE: LOCALE_HE };
}
