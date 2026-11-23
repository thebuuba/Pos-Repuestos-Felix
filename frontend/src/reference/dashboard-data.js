// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
var MONTHLY_SALES = [
  {
    month: "Ene",
    total: 612000,
  },
  {
    month: "Feb",
    total: 548000,
  },
  {
    month: "Mar",
    total: 701000,
  },
  {
    month: "Abr",
    total: 664000,
  },
  {
    month: "May",
    total: 742000,
  },
  {
    month: "Jun",
    total: 815000,
  },
  {
    month: "Jul",
    total: 788000,
  },
  {
    month: "Ago",
    total: 736000,
  },
  {
    month: "Sep",
    total: 690000,
  },
  {
    month: "Oct",
    total: 842000,
  },
  {
    month: "Nov",
    total: 905400.75,
  },
  {
    month: "Dic",
    total: 0,
  },
];
var CURRENT_MONTH_INDEX = 10;
var DAILY_GOAL = {
  goal: 65000,
  achieved: 48520.5,
  cash: 27340,
  card: 13880.5,
  transfer: 7300,
};
var PEAK_HOURS = {
  days: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  hours: ["8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p"],
  values: [
    [2, 4, 6, 7, 5, 3, 4, 6, 7, 5, 2],
    [1, 3, 5, 8, 6, 2, 3, 5, 6, 4, 2],
    [2, 5, 7, 9, 6, 3, 4, 7, 8, 6, 3],
    [1, 4, 6, 7, 4, 2, 3, 6, 7, 5, 2],
    [3, 6, 9, 11, 8, 4, 6, 9, 10, 8, 4],
    [5, 9, 12, 12, 10, 7, 6, 5, 3, 2, 1],
  ],
};
export { MONTHLY_SALES, CURRENT_MONTH_INDEX, DAILY_GOAL, PEAK_HOURS };
