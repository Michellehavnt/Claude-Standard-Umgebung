import { DateFilter } from '../types/vendor';

export function getDateRange(filter: DateFilter): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);

  let startDate: Date;

  switch (filter.type) {
    case 'today':
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'this_week':
      startDate = new Date(now);
      const dayOfWeek = startDate.getDay();
      const diff = startDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Montag als Start
      startDate.setDate(diff);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'this_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      startDate.setHours(0, 0, 0, 0);
      endDate.setDate(0); // Letzter Tag des vorherigen Monats
      endDate.setHours(23, 59, 59, 999);
      break;

    case '3_months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 3);
      startDate.setHours(0, 0, 0, 0);
      break;

    case '6_months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 6);
      startDate.setHours(0, 0, 0, 0);
      break;

    case 'custom':
      if (!filter.startDate || !filter.endDate) {
        throw new Error('Custom date range requires startDate and endDate');
      }
      startDate = new Date(filter.startDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setTime(new Date(filter.endDate).getTime());
      endDate.setHours(23, 59, 59, 999);
      break;

    default:
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
  }

  return { startDate, endDate };
}

export function getPreviousPeriodRange(filter: DateFilter): { startDate: Date; endDate: Date } {
  const { startDate, endDate } = getDateRange(filter);
  const periodLength = endDate.getTime() - startDate.getTime();

  return {
    startDate: new Date(startDate.getTime() - periodLength),
    endDate: new Date(startDate.getTime() - 1),
  };
}

export function getWeekNumber(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

export function getWeeksInRange(startDate: Date, endDate: Date): Array<{ week: number; year: number; startDate: Date; endDate: Date }> {
  const weeks: Array<{ week: number; year: number; startDate: Date; endDate: Date }> = [];
  const current = new Date(startDate);

  // Gehe zum Montag der aktuellen Woche
  const day = current.getDay();
  const diff = current.getDate() - day + (day === 0 ? -6 : 1);
  current.setDate(diff);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const { week, year } = getWeekNumber(current);
    const weekStart = new Date(current);
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    weeks.push({
      week,
      year,
      startDate: weekStart,
      endDate: weekEnd,
    });

    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

export function formatWeekLabel(week: number, year: number): string {
  return `KW ${week}/${year}`;
}

export function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}
