/** Shared minimal bodies for M2-3B extractor tests (not live network). */

export const FOMC_MAINTAIN = `
The Federal Open Market Committee approved the following statement for release by a 9-3 vote.
The Committee decided to maintain the target range for the federal funds rate at 4.25 to 4.50 percent.
Voting against this monetary policy action were Governor A and Governor B.
`.trim();

export const FOMC_RAISE = `
The Committee decided to raise the target range for the federal funds rate to 4.50 to 4.75 percent.
`.trim();

export const FOMC_CUT = `
The Committee decided to lower the target range for the federal funds rate to 4.00 to 4.25 percent.
`.trim();

export const CPI_BODY = `
THE CONSUMER PRICE INDEX -- JUNE 2026
The Consumer Price Index for All Urban Consumers increased 0.1 percent in June on a seasonally adjusted basis.
The Consumer Price Index for All Urban Consumers increased 2.7 percent over the last 12 months.
The index for all items less food and energy increased 0.2 percent in June.
The index for all items less food and energy increased 2.9 percent over the last 12 months.
`.trim();

export const EMPLOYMENT_BODY = `
THE EMPLOYMENT SITUATION -- JUNE 2026
Total nonfarm payroll employment increased by 147 thousand in June.
The unemployment rate was 4.1 percent.
The change in total nonfarm payroll employment for May was revised down by 22.
`.trim();

export const GDP_BODY = `
Gross Domestic Product, 1st Quarter 2026 (Third Estimate)
Real gross domestic product increased at an annual rate of 2.1 percent in the first quarter.
In the second estimate, real GDP increased 2.0 percent.
`.trim();

export const PIO_BODY = `
Personal Income and Outlays, May 2026.
Personal income increased 0.4 percent in May.
Disposable personal income increased 0.3 percent.
Personal consumption expenditures increased 0.2 percent.
The PCE price index increased 2.5 percent from the same month a year ago.
The PCE price index excluding food and energy increased 2.7 percent from the same month a year ago.
`.trim();

export const TRADE_BODY = `
U.S. International Trade in Goods and Services, May 2026
The goods and services deficit was $77.6 billion in May.
Exports were $265.9 billion.
Imports were $343.5 billion.
The deficit increased $23.0 billion from April.
`.trim();
