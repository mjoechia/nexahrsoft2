export type SHGFund = 'CDAC' | 'SINDA' | 'MBMF' | 'ECF' | null;

export interface SHGResult {
  fund: SHGFund;
  contribution: number;
  fundLabel: string;
}

function calculateCDAC(mtw: number): number {
  if (mtw <= 2000) return 0.50;
  if (mtw <= 3500) return 1.00;
  if (mtw <= 5000) return 1.50;
  if (mtw <= 7500) return 2.00;
  return 3.00;
}

function calculateSINDA(mtw: number): number {
  if (mtw <= 1000) return 1.00;
  if (mtw <= 1500) return 3.00;
  if (mtw <= 2500) return 5.00;
  if (mtw <= 4500) return 7.00;
  if (mtw <= 7500) return 9.00;
  if (mtw <= 10000) return 12.00;
  if (mtw <= 15000) return 18.00;
  return 30.00;
}

function calculateMBMF(mtw: number): number {
  if (mtw <= 1000) return 3.00;
  if (mtw <= 2000) return 4.50;
  if (mtw <= 3000) return 6.50;
  if (mtw <= 4000) return 15.00;
  if (mtw <= 6000) return 19.50;
  if (mtw <= 8000) return 22.00;
  if (mtw <= 10000) return 24.00;
  return 26.00;
}

function calculateECF(mtw: number): number {
  if (mtw <= 1000) return 2.00;
  if (mtw <= 1500) return 4.00;
  if (mtw <= 2500) return 6.00;
  if (mtw <= 4000) return 9.00;
  if (mtw <= 7000) return 12.00;
  if (mtw <= 10000) return 16.00;
  return 20.00;
}

export function determineSHGFund(
  ethnicity: string | null | undefined,
  religion: string | null | undefined,
  residencyStatus: string | null | undefined,
): SHGFund {
  const isSingaporean = residencyStatus === 'SC' || residencyStatus === 'SPR';
  const isForeigner = !isSingaporean;

  if (religion?.toLowerCase() === 'muslim') {
    return 'MBMF';
  }

  const eth = ethnicity?.toLowerCase();
  if (eth === 'chinese') {
    return isForeigner ? null : 'CDAC';
  }
  if (eth === 'indian') {
    return 'SINDA';
  }
  if (eth === 'eurasian') {
    return isForeigner ? null : 'ECF';
  }

  return null;
}

export function calculateSHG(
  ethnicity: string | null | undefined,
  religion: string | null | undefined,
  residencyStatus: string | null | undefined,
  monthlyTotalWages: number,
  shgOptOut: boolean = false,
): SHGResult {
  const fund = determineSHGFund(ethnicity, religion, residencyStatus);

  if (!fund || monthlyTotalWages <= 0) {
    return { fund: null, contribution: 0, fundLabel: 'None' };
  }

  // Foreigners are automatically opted out of non-MBMF SHG (SINDA/CDAC/ECF)
  // MBMF remains applicable to Muslim foreigners (e.g. EP holders)
  const isForeigner = residencyStatus !== 'SC' && residencyStatus !== 'SPR';
  if ((shgOptOut || isForeigner) && fund !== 'MBMF') {
    return { fund, contribution: 0, fundLabel: fund };
  }

  let contribution = 0;
  switch (fund) {
    case 'CDAC':
      contribution = calculateCDAC(monthlyTotalWages);
      break;
    case 'SINDA':
      contribution = calculateSINDA(monthlyTotalWages);
      break;
    case 'MBMF':
      contribution = calculateMBMF(monthlyTotalWages);
      break;
    case 'ECF':
      contribution = calculateECF(monthlyTotalWages);
      break;
  }

  return { fund, contribution, fundLabel: fund };
}
