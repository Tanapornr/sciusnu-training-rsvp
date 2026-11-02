export const OUTLOOK_CALENDAR = 'https://outlook.cloud.microsoft/calendar/view/workweek';

export function calendarHref({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  // iPadOS can identify as a Mac. Open the event file without forcing a download.
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    return '/event.ics';
  }
  if (/Android/i.test(userAgent)) {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: 'SCiUS NU Training — โครงการพัฒนาศักยภาพบุคลากร ครูและอาจารย์ โครงการ วมว.',
      dates: '20261121T020000Z/20261121T090000Z',
      ctz: 'Asia/Bangkok',
      details: '09.00–12.00 น. จิตวิทยาในการสอน\n13.00–16.00 น. เทคนิคการรับมือและปฐมพยาบาลทางใจในสถานศึกษา',
    });
    const webUrl = `https://calendar.google.com/calendar/render?${params}`;
    // A normal anchor click supplies the user gesture required by Android browsers.
    // Fall back to the event form on the web when the Calendar app cannot open it.
    return `intent://calendar.google.com/calendar/render?${params}#Intent;scheme=https;package=com.google.android.calendar;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  }
  return OUTLOOK_CALENDAR;
}
