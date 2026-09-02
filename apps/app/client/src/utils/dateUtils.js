export function toDateStr(d) {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateStr(str) {
  if (!str) return new Date();
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isToday(d) {
  return toDateStr(d) === toDateStr(new Date());
}

export function isSameDay(d1, d2) {
  return toDateStr(d1) === toDateStr(d2);
}

export function formatMonthYear(d) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function formatDayHeader(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function getMonthGrid(year, month) {
  // month: 0-indexed (0 = Jan, 8 = Sep)
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Day of week of first day (0 = Sunday)
  const startDayOfWeek = firstDayOfMonth.getDay();
  const totalDaysInMonth = lastDayOfMonth.getDate();

  const days = [];

  // Previous month padding days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevMonthLastDay - i);
    days.push({
      date: d,
      dateStr: toDateStr(d),
      dayNumber: d.getDate(),
      isCurrentMonth: false,
      isToday: isToday(d)
    });
  }

  // Current month days
  for (let day = 1; day <= totalDaysInMonth; day++) {
    const d = new Date(year, month, day);
    days.push({
      date: d,
      dateStr: toDateStr(d),
      dayNumber: day,
      isCurrentMonth: true,
      isToday: isToday(d)
    });
  }

  // Next month padding days to complete 35 or 42 grid cells
  const remainingCells = (7 - (days.length % 7)) % 7;
  // If total cells is 28 or 35 and we want standard 35 or 42
  const targetTotal = days.length + remainingCells <= 35 ? 35 : 42;
  const daysToAdd = targetTotal - days.length;

  for (let i = 1; i <= daysToAdd; i++) {
    const d = new Date(year, month + 1, i);
    days.push({
      date: d,
      dateStr: toDateStr(d),
      dayNumber: d.getDate(),
      isCurrentMonth: false,
      isToday: isToday(d)
    });
  }

  return days;
}

export function getWeekDays(referenceDate) {
  const d = new Date(referenceDate);
  const dayOfWeek = d.getDay(); // 0 = Sunday
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() - dayOfWeek);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(startOfWeek);
    current.setDate(startOfWeek.getDate() + i);
    week.push({
      date: current,
      dateStr: toDateStr(current),
      dayNumber: current.getDate(),
      dayName: current.toLocaleDateString(undefined, { weekday: 'short' }),
      isToday: isToday(current)
    });
  }
  return week;
}
