// UPI payee for registration fees, as given by the organizers. It is printed in every payment QR, so it is not secret.
export const payment = {
  payeeAddress: 'jashanthlina@ybl',
  payeeName: 'Gonipati Jashanth',
  note: 'KGRCET Hackathon 2027',
} as const

/** A UPI link with the amount set, so the payer's app opens with it filled in. */
export function upiLink(amount: number, teamName: string) {
  const params = new URLSearchParams({
    pa: payment.payeeAddress,
    pn: payment.payeeName,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `${payment.note} - ${teamName}`.slice(0, 50),
  })
  return `upi://pay?${params.toString().replace(/\+/g, '%20')}`
}
