import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// English plus India's 22 scheduled languages. All translations are first drafts that must be reviewed
// by native speakers before launch. Missing keys fall back to English. Other languages load on demand.
export type Lang =
  | 'en' | 'as' | 'bn' | 'brx' | 'doi' | 'gu' | 'hi' | 'kn' | 'ks' | 'kok' | 'mai' | 'ml'
  | 'mni' | 'mr' | 'ne' | 'or' | 'pa' | 'sa' | 'sat' | 'sd' | 'ta' | 'te' | 'ur';

// Native names, in the order of the Eighth Schedule (English first).
export const LANGS: Record<Lang, string> = {
  en: 'English', as: 'অসমীয়া', bn: 'বাংলা', brx: 'बर’', doi: 'डोगरी', gu: 'ગુજરાતી', hi: 'हिन्दी', kn: 'ಕನ್ನಡ',
  ks: 'کٲشُر', kok: 'कोंकणी', mai: 'मैथिली', ml: 'മലയാളം', mni: 'ꯃꯤꯇꯩꯂꯣꯟ (Manipuri)', mr: 'मराठी', ne: 'नेपाली',
  or: 'ଓଡ଼ିଆ', pa: 'ਪੰਜਾਬੀ', sa: 'संस्कृतम्', sat: 'ᱥᱟᱱᱛᱟᱲᱤ (Santali)', sd: 'سنڌي', ta: 'தமிழ்', te: 'తెలుగు', ur: 'اردو',
};
export const RTL: Lang[] = ['ur', 'ks', 'sd'];
// No translation yet: these show English with a note, rather than risk wrong text in alerts.
export const NEEDS_TRANSLATOR: Lang[] = ['brx', 'mni', 'sat'];
export const LOW_CONFIDENCE: Lang[] = ['doi', 'kok', 'ks', 'mai', 'sd'];

// The most visible strings, translated for every language. Locale files list them in this order.
export const CORE_KEYS = [
  'nav.home', 'nav.events', 'nav.report', 'nav.reportLong', 'nav.utilities', 'nav.profile', 'nav.scorecard', 'nav.petitions', 'nav.missions', 'nav.signIn',
  'settings.language', 'settings.theme', 'theme.light', 'theme.dark', 'theme.system', 'greet.morning', 'greet.afternoon', 'greet.evening',
  'city.title', 'city.open', 'city.resolved', 'city.report', 'cat.all', 'cat.roads', 'cat.waste', 'cat.lighting', 'cat.water', 'cat.parks', 'cat.other',
  'search.placeholder', 'sort.latest', 'sort.near', 'sort.backed', 'sort.following', 'filter.open', 'filter.fixed', 'feed.latest', 'feed.nearYou',
  'view.map', 'card.back', 'card.share', 'amber.missing', 'amber.lastSeen', 'amber.call112', 'amber.seen', 'loc.title', 'loc.allow', 'loc.later',
  'report.title', 'report.submit', 'empty.none',
] as const;

const LOADERS: Partial<Record<Lang, () => Promise<{ default: string[] }>>> = {
  as: () => import('./locales/as'), bn: () => import('./locales/bn'), doi: () => import('./locales/doi'), gu: () => import('./locales/gu'),
  hi: () => import('./locales/hi'), kn: () => import('./locales/kn'), ks: () => import('./locales/ks'), kok: () => import('./locales/kok'),
  mai: () => import('./locales/mai'), ml: () => import('./locales/ml'), mr: () => import('./locales/mr'), ne: () => import('./locales/ne'),
  or: () => import('./locales/or'), pa: () => import('./locales/pa'), sa: () => import('./locales/sa'), sd: () => import('./locales/sd'),
  ta: () => import('./locales/ta'),
};

const en = {
  'nav.home': 'Home', 'nav.events': 'Events', 'nav.report': 'Report', 'nav.reportLong': 'Report an issue', 'nav.utilities': 'Utilities', 'nav.profile': 'Profile',
  'nav.scorecard': 'Scorecard', 'nav.petitions': 'Petitions', 'nav.missions': 'Missions', 'nav.openData': 'Open data', 'nav.admin': 'Admin console',
  'nav.buses': 'Buses', 'nav.signIn': 'Sign in', 'nav.skip': 'Skip to main content', 'nav.signOut': 'Sign out', 'nav.privacy': 'Privacy', 'nav.terms': 'Terms', 'nav.advertise': 'Advertise',
  'settings.language': 'Language', 'settings.theme': 'Appearance', 'theme.system': 'Device', 'theme.light': 'Light', 'theme.dark': 'Dark',
  'settings.draft': 'Telugu and Urdu translations are in review.',
  'greet.morning': 'Good morning', 'greet.afternoon': 'Good afternoon', 'greet.evening': 'Good evening',
  'city.title': 'Your city at a glance', 'city.open': 'Open', 'city.resolved': 'Resolved', 'city.fixRate': 'Fix rate',
  'city.new7': 'New · 7 days', 'city.fixed7': 'Fixed · 7 days', 'city.avgFix': 'Avg fix', 'city.report': 'Report an issue', 'city.late': 'late',
  'quick.petitions': 'Petitions', 'quick.missions': 'Missions', 'quick.bills': 'Pay bills', 'quick.helplines': 'Helplines',
  'cat.all': 'All', 'cat.roads': 'Roads', 'cat.waste': 'Sanitation', 'cat.lighting': 'Street', 'cat.water': 'Water', 'cat.parks': 'Parks', 'cat.other': 'Other',
  'search.placeholder': 'Search reports, areas or CP number', 'search.clear': 'Clear search',
  'sort.latest': 'Latest', 'sort.updated': 'Recently updated', 'sort.backed': 'Most backed', 'sort.near': 'Near me', 'sort.attention': 'Needs attention', 'sort.following': 'Following', 'sort.finding': 'Finding you…',
  'filter.allStatus': 'All statuses', 'filter.open': 'Open only', 'filter.fixed': 'Fixed only', 'filter.anyTime': 'Any time', 'filter.today': 'Today', 'filter.week': 'This week', 'filter.month': 'This month',
  'filter.allAreas': 'All areas', 'filter.clear': 'Clear filters', 'filter.within': 'Within', 'filter.city': 'Whole city',
  'area.choose': 'Choose area', 'area.near': 'Near {x}',
  'feed.tabReports': 'Reports', 'feed.tabCommunity': 'Community contribution',
  'feed.latest': 'Latest reports', 'feed.nearYou': 'Reports near you', 'feed.nearPlace': 'Reports near {x}', 'feed.attention': 'Past the promised fix date', 'feed.backed': 'Most backed reports',
  'feed.following': 'Reports you made, back or follow', 'feed.updated': 'Recently updated', 'feed.inArea': 'Reports in {x}', 'feed.results': 'Results for “{x}”',
  'view.grid': 'Grid', 'view.list': 'List', 'view.map': 'Map', 'feed.loadMore': 'Load more', 'feed.loadingMore': 'Loading more…',
  'feed.newReports': '{n} new reports · Show', 'feed.error': 'Could not load the feed.', 'feed.retry': 'Try again',
  'empty.none': 'Nothing reported here yet', 'empty.first': 'Be the first to flag something in your area.', 'empty.search': 'No reports match your search',
  'empty.filters': 'No reports match these filters', 'empty.follow': 'You are not following any reports yet', 'empty.followHint': 'Back or follow a report and it will appear here, with every update.',
  'empty.browse': 'Browse latest reports', 'empty.nearNone': 'No reports within {r} of {x}', 'empty.nearGood': 'Good news, or nobody has reported yet.', 'empty.widen': 'Widen to {r}', 'empty.reportHere': 'Report something here',
  'card.back': 'Back', 'card.follow': 'Follow', 'card.following': 'Following', 'card.share': 'Share',
  'widget.fixed': 'Recently fixed', 'widget.beforeAfter': 'Before and after', 'widget.trending': 'Trending now', 'widget.upcoming': 'Coming up', 'widget.allEvents': 'All events', 'widget.forYou': 'For you',
  'amber.missing': 'MISSING CHILD', 'amber.lastSeen': 'Last seen', 'amber.call112': 'Call 112', 'amber.seen': "I've seen this child", 'amber.share': 'Share', 'amber.dontApproach': 'Do not approach anyone yourself; call the police.',
  'loc.title': "See what's happening near you", 'loc.body': 'CivicPulse can show reports, fixes and alerts closest to you first, and fill in the location when you report a problem.',
  'loc.private': 'Your location stays on this device. It is never shown to anyone or saved to your profile.', 'loc.later': "Not now, I'll search", 'loc.allow': 'Allow location',
  'report.title': 'Report an issue', 'report.category': 'What kind of problem?', 'report.what': 'What is the problem?', 'report.where': 'Where is it?', 'report.photos': 'Photos', 'report.submit': 'Submit report', 'report.submitting': 'Submitting…',
};
type Key = keyof typeof en;
export type TKey = Key;

const te: Partial<Record<Key, string>> = {
  'nav.home': 'హోమ్', 'nav.events': 'కార్యక్రమాలు', 'nav.report': 'ఫిర్యాదు', 'nav.reportLong': 'సమస్యను తెలియజేయండి', 'nav.utilities': 'సేవలు', 'nav.profile': 'ప్రొఫైల్',
  'nav.buses': 'బస్సులు', 'nav.scorecard': 'స్కోర్‌కార్డ్', 'nav.petitions': 'పిటిషన్లు', 'nav.missions': 'మిషన్లు', 'nav.openData': 'ఓపెన్ డేటా', 'nav.admin': 'అడ్మిన్', 'nav.signIn': 'సైన్ ఇన్', 'nav.skip': 'ప్రధాన కంటెంట్‌కు వెళ్లండి', 'nav.signOut': 'సైన్ అవుట్',
  'nav.privacy': 'గోప్యత', 'nav.terms': 'నిబంధనలు', 'nav.advertise': 'ప్రకటనలు',
  'settings.language': 'భాష', 'settings.theme': 'రూపం', 'theme.system': 'పరికరం', 'theme.light': 'లైట్', 'theme.dark': 'డార్క్',
  'greet.morning': 'శుభోదయం', 'greet.afternoon': 'శుభ మధ్యాహ్నం', 'greet.evening': 'శుభ సాయంత్రం',
  'city.title': 'మీ నగరం ఒక్క చూపులో', 'city.open': 'తెరిచి ఉన్నవి', 'city.resolved': 'పరిష్కరించినవి', 'city.fixRate': 'పరిష్కార రేటు',
  'city.new7': 'కొత్తవి · 7 రోజులు', 'city.fixed7': 'పరిష్కారం · 7 రోజులు', 'city.avgFix': 'సగటు సమయం', 'city.report': 'సమస్యను తెలియజేయండి', 'city.late': 'ఆలస్యం',
  'quick.petitions': 'పిటిషన్లు', 'quick.missions': 'మిషన్లు', 'quick.bills': 'బిల్లులు', 'quick.helplines': 'హెల్ప్‌లైన్లు',
  'cat.all': 'అన్నీ', 'cat.roads': 'రోడ్లు', 'cat.waste': 'పారిశుధ్యం', 'cat.lighting': 'వీధి దీపాలు', 'cat.water': 'నీరు', 'cat.parks': 'పార్కులు', 'cat.other': 'ఇతర',
  'search.placeholder': 'ఫిర్యాదులు, ప్రాంతాలు లేదా CP నంబర్ వెతకండి', 'search.clear': 'తొలగించు',
  'sort.latest': 'తాజావి', 'sort.updated': 'ఇటీవల మారినవి', 'sort.backed': 'ఎక్కువ మద్దతు', 'sort.near': 'నా దగ్గర', 'sort.attention': 'దృష్టి అవసరం', 'sort.following': 'అనుసరిస్తున్నవి', 'sort.finding': 'వెతుకుతోంది…',
  'filter.allStatus': 'అన్ని స్థితులు', 'filter.open': 'తెరిచినవి మాత్రమే', 'filter.fixed': 'పరిష్కరించినవి మాత్రమే', 'filter.anyTime': 'ఎప్పుడైనా', 'filter.today': 'ఈరోజు', 'filter.week': 'ఈ వారం', 'filter.month': 'ఈ నెల',
  'filter.allAreas': 'అన్ని ప్రాంతాలు', 'filter.clear': 'ఫిల్టర్లు తొలగించు', 'filter.within': 'పరిధి', 'filter.city': 'మొత్తం నగరం',
  'area.choose': 'ప్రాంతం ఎంచుకోండి', 'area.near': '{x} దగ్గర',
  'feed.tabReports': 'ఫిర్యాదులు', 'feed.tabCommunity': 'సమాజ సేవ',
  'feed.latest': 'తాజా ఫిర్యాదులు', 'feed.nearYou': 'మీ దగ్గరి ఫిర్యాదులు', 'feed.nearPlace': '{x} దగ్గరి ఫిర్యాదులు', 'feed.attention': 'హామీ తేదీ దాటినవి', 'feed.backed': 'ఎక్కువ మద్దతు ఉన్నవి',
  'feed.following': 'మీరు చేసిన, మద్దతిచ్చిన లేదా అనుసరిస్తున్నవి', 'feed.updated': 'ఇటీవల మారినవి', 'feed.inArea': '{x}లో ఫిర్యాదులు', 'feed.results': '“{x}” ఫలితాలు',
  'view.grid': 'గ్రిడ్', 'view.list': 'జాబితా', 'view.map': 'మ్యాప్', 'feed.loadMore': 'మరిన్ని', 'feed.loadingMore': 'లోడ్ అవుతోంది…',
  'feed.newReports': '{n} కొత్త ఫిర్యాదులు · చూపించు', 'feed.error': 'ఫీడ్ లోడ్ కాలేదు.', 'feed.retry': 'మళ్ళీ ప్రయత్నించండి',
  'empty.none': 'ఇక్కడ ఇంకా ఏ ఫిర్యాదూ లేదు', 'empty.first': 'మీ ప్రాంతంలో మొదటి ఫిర్యాదు మీరే చేయండి.', 'empty.search': 'మీ శోధనకు సరిపోయే ఫిర్యాదులు లేవు',
  'empty.filters': 'ఈ ఫిల్టర్లకు సరిపోయేవి లేవు', 'empty.follow': 'మీరు ఇంకా ఏ ఫిర్యాదునూ అనుసరించడం లేదు', 'empty.browse': 'తాజా ఫిర్యాదులు చూడండి',
  'empty.nearNone': '{x} నుండి {r} లోపు ఫిర్యాదులు లేవు', 'empty.widen': '{r}కి పెంచండి', 'empty.reportHere': 'ఇక్కడ ఫిర్యాదు చేయండి',
  'card.back': 'మద్దతు', 'card.follow': 'అనుసరించు', 'card.following': 'అనుసరిస్తున్నారు', 'card.share': 'షేర్',
  'widget.fixed': 'ఇటీవల పరిష్కరించినవి', 'widget.beforeAfter': 'ముందు మరియు తర్వాత', 'widget.trending': 'ఇప్పుడు ట్రెండింగ్', 'widget.upcoming': 'రాబోయేవి', 'widget.allEvents': 'అన్ని కార్యక్రమాలు', 'widget.forYou': 'మీ కోసం',
  'amber.missing': 'తప్పిపోయిన చిన్నారి', 'amber.lastSeen': 'చివరిసారి కనిపించింది', 'amber.call112': '112కి కాల్ చేయండి', 'amber.seen': 'ఈ చిన్నారిని చూశాను', 'amber.share': 'షేర్', 'amber.dontApproach': 'మీరే ఎవరినీ సమీపించకండి; పోలీసులకు కాల్ చేయండి.',
  'loc.title': 'మీ దగ్గర ఏం జరుగుతోందో చూడండి', 'loc.body': 'మీకు దగ్గరగా ఉన్న ఫిర్యాదులు, పరిష్కారాలు, హెచ్చరికలను ముందుగా చూపిస్తుంది.',
  'loc.private': 'మీ లొకేషన్ ఈ పరికరంలోనే ఉంటుంది. ఎవరికీ చూపించబడదు.', 'loc.later': 'ఇప్పుడు కాదు, వెతుకుతాను', 'loc.allow': 'లొకేషన్ అనుమతించు',
  'report.title': 'సమస్యను తెలియజేయండి', 'report.category': 'ఏ రకమైన సమస్య?', 'report.what': 'సమస్య ఏమిటి?', 'report.where': 'ఎక్కడ ఉంది?', 'report.photos': 'ఫోటోలు', 'report.submit': 'ఫిర్యాదు పంపండి', 'report.submitting': 'పంపుతోంది…',
};

const ur: Partial<Record<Key, string>> = {
  'nav.home': 'ہوم', 'nav.events': 'تقریبات', 'nav.report': 'شکایت', 'nav.reportLong': 'مسئلہ درج کریں', 'nav.utilities': 'خدمات', 'nav.profile': 'پروفائل',
  'nav.buses': 'بسیں', 'nav.scorecard': 'اسکور کارڈ', 'nav.petitions': 'درخواستیں', 'nav.missions': 'مشن', 'nav.openData': 'اوپن ڈیٹا', 'nav.admin': 'ایڈمن', 'nav.signIn': 'سائن ان', 'nav.skip': 'مرکزی مواد پر جائیں', 'nav.signOut': 'سائن آؤٹ',
  'nav.privacy': 'رازداری', 'nav.terms': 'شرائط', 'nav.advertise': 'اشتہار',
  'settings.language': 'زبان', 'settings.theme': 'ظاہری شکل', 'theme.system': 'آلہ', 'theme.light': 'روشن', 'theme.dark': 'تاریک',
  'greet.morning': 'صبح بخیر', 'greet.afternoon': 'سہ پہر بخیر', 'greet.evening': 'شام بخیر',
  'city.title': 'آپ کا شہر ایک نظر میں', 'city.open': 'کھلے', 'city.resolved': 'حل شدہ', 'city.fixRate': 'حل کی شرح',
  'city.new7': 'نئے · 7 دن', 'city.fixed7': 'حل · 7 دن', 'city.avgFix': 'اوسط وقت', 'city.report': 'مسئلہ درج کریں', 'city.late': 'تاخیر',
  'quick.petitions': 'درخواستیں', 'quick.missions': 'مشن', 'quick.bills': 'بل ادا کریں', 'quick.helplines': 'ہیلپ لائن',
  'cat.all': 'سب', 'cat.roads': 'سڑکیں', 'cat.waste': 'صفائی', 'cat.lighting': 'روشنی', 'cat.water': 'پانی', 'cat.parks': 'پارک', 'cat.other': 'دیگر',
  'search.placeholder': 'شکایات، علاقے یا CP نمبر تلاش کریں', 'search.clear': 'صاف کریں',
  'sort.latest': 'تازہ ترین', 'sort.updated': 'حال میں تبدیل', 'sort.backed': 'سب سے زیادہ حمایت', 'sort.near': 'میرے قریب', 'sort.attention': 'توجہ درکار', 'sort.following': 'فالو کردہ', 'sort.finding': 'تلاش جاری…',
  'filter.allStatus': 'تمام حالتیں', 'filter.open': 'صرف کھلے', 'filter.fixed': 'صرف حل شدہ', 'filter.anyTime': 'کسی بھی وقت', 'filter.today': 'آج', 'filter.week': 'اس ہفتے', 'filter.month': 'اس مہینے',
  'filter.allAreas': 'تمام علاقے', 'filter.clear': 'فلٹر ہٹائیں', 'filter.within': 'فاصلہ', 'filter.city': 'پورا شہر',
  'area.choose': 'علاقہ منتخب کریں', 'area.near': '{x} کے قریب',
  'feed.tabReports': 'شکایات', 'feed.tabCommunity': 'کمیونٹی خدمات',
  'feed.latest': 'تازہ شکایات', 'feed.nearYou': 'آپ کے قریب شکایات', 'feed.nearPlace': '{x} کے قریب شکایات', 'feed.attention': 'وعدہ شدہ تاریخ گزر چکی', 'feed.backed': 'سب سے زیادہ حمایت یافتہ',
  'feed.following': 'آپ کی، حمایت یا فالو کردہ شکایات', 'feed.updated': 'حال میں تبدیل', 'feed.inArea': '{x} میں شکایات', 'feed.results': '“{x}” کے نتائج',
  'view.grid': 'گرڈ', 'view.list': 'فہرست', 'view.map': 'نقشہ', 'feed.loadMore': 'مزید', 'feed.loadingMore': 'لوڈ ہو رہا ہے…',
  'feed.newReports': '{n} نئی شکایات · دکھائیں', 'feed.error': 'فیڈ لوڈ نہیں ہو سکی۔', 'feed.retry': 'دوبارہ کوشش کریں',
  'empty.none': 'یہاں ابھی کوئی شکایت نہیں', 'empty.first': 'اپنے علاقے میں پہلی شکایت درج کریں۔', 'empty.search': 'آپ کی تلاش سے کوئی شکایت نہیں ملی',
  'empty.filters': 'ان فلٹرز سے کچھ نہیں ملا', 'empty.follow': 'آپ ابھی کسی شکایت کو فالو نہیں کر رہے', 'empty.browse': 'تازہ شکایات دیکھیں',
  'empty.nearNone': '{x} سے {r} کے اندر کوئی شکایت نہیں', 'empty.widen': '{r} تک بڑھائیں', 'empty.reportHere': 'یہاں شکایت درج کریں',
  'card.back': 'حمایت', 'card.follow': 'فالو', 'card.following': 'فالو کر رہے ہیں', 'card.share': 'شیئر',
  'widget.fixed': 'حال میں حل شدہ', 'widget.beforeAfter': 'پہلے اور بعد', 'widget.trending': 'اس وقت نمایاں', 'widget.upcoming': 'آنے والی', 'widget.allEvents': 'تمام تقریبات', 'widget.forYou': 'آپ کے لیے',
  'amber.missing': 'لاپتہ بچہ', 'amber.lastSeen': 'آخری بار دیکھا گیا', 'amber.call112': '112 پر کال کریں', 'amber.seen': 'میں نے اس بچے کو دیکھا ہے', 'amber.share': 'شیئر', 'amber.dontApproach': 'خود کسی کے پاس نہ جائیں؛ پولیس کو کال کریں۔',
  'loc.title': 'دیکھیں آپ کے قریب کیا ہو رہا ہے', 'loc.body': 'آپ کے قریب ترین شکایات، حل اور انتباہات پہلے دکھائے جائیں گے۔',
  'loc.private': 'آپ کا مقام اسی آلے پر رہتا ہے اور کسی کو نہیں دکھایا جاتا۔', 'loc.later': 'ابھی نہیں، میں تلاش کروں گا', 'loc.allow': 'مقام کی اجازت دیں',
  'report.title': 'مسئلہ درج کریں', 'report.category': 'کس قسم کا مسئلہ؟', 'report.what': 'مسئلہ کیا ہے؟', 'report.where': 'یہ کہاں ہے؟', 'report.photos': 'تصاویر', 'report.submit': 'شکایت بھیجیں', 'report.submitting': 'بھیجا جا رہا ہے…',
};

const BUILT_IN: Partial<Record<Lang, Partial<Record<Key, string>>>> = { en, te, ur };
const KEY = 'civicpulse:lang';
const isLang = (v: string | null): v is Lang => Boolean(v && v in LANGS);

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (k: Key, vars?: Record<string, string | number>) => string }
const Ctx = createContext<I18n | null>(null);

function initial(): Lang {
  try { const v = localStorage.getItem(KEY); if (isLang(v)) return v; } catch { /* private mode */ }
  // Use the device language when we have it (e.g. hi-IN -> hi).
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l.toLowerCase().split('-')[0];
    if (isLang(base) && base !== 'en') return base;
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const [loaded, setLoaded] = useState<Partial<Record<Lang, Partial<Record<Key, string>>>>>(BUILT_IN);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.includes(lang) ? 'rtl' : 'ltr';
    const load = LOADERS[lang];
    if (!load || loaded[lang]) return;
    let alive = true;
    load().then((m) => {
      if (!alive) return;
      const dict = Object.fromEntries(CORE_KEYS.map((k, i) => [k, m.default[i]]).filter(([, v]) => v)) as Partial<Record<Key, string>>;
      setLoaded((prev) => ({ ...prev, [lang]: dict }));
    }).catch(() => { /* offline: stay in English until it loads */ });
    return () => { alive = false; };
  }, [lang, loaded]);
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem(KEY, l); } catch { /* private mode */ } }, []);
  const t = useCallback((k: Key, vars?: Record<string, string | number>) => {
    let s = loaded[lang]?.[k] ?? en[k] ?? k;
    if (vars) for (const [name, v] of Object.entries(vars)) s = s.replace(`{${name}}`, String(v));
    return s;
  }, [lang, loaded]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useT must be used inside LanguageProvider');
  return v;
}
