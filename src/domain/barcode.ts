/**
 * Barcodes, as digits. Nothing here touches the network or the camera.
 *
 * The digits printed under a barcode are the fallback for every device that cannot scan — iOS Safari, Firefox, a
 * refused camera, a page that is not on a secure origin — so they have to be checked before a lookup, or a typo
 * becomes "that product is not in Open Food Facts" and sends the person off to type the nutrition by hand.
 */

/** The formats this app asks `BarcodeDetector` for, and the lengths it therefore has to accept. */
export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

/** Digits only: spaces, dashes and the odd non-breaking space a keyboard inserts are dropped. */
export function normaliseBarcode(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * The GS1 mod-10 check digit: from the right, every second digit counts triple, and the total must be a multiple
 * of ten. Applied to 12- and 13-digit codes (UPC-A and EAN-13), which is what nearly every packet in a Spanish
 * supermarket carries.
 */
function checkDigitOk(code: string): boolean {
  let sum = 0;
  for (let i = code.length - 2; i >= 0; i--) {
    const digit = Number(code[i]);
    sum += (code.length - i) % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]);
}

/**
 * A sentence saying why this cannot be a barcode, or null when it can be looked up.
 *
 * The check digit is tested for 12 and 13 digits ONLY. An 8-digit code may be an EAN-8 or a UPC-E, and a UPC-E
 * carries the check digit of the UPC-A it expands to, so testing it under the EAN-8 rule would refuse valid
 * scans. Eight digits are accepted on length alone, and a mistyped one simply comes back as "not found".
 */
export function barcodeProblem(text: string): string | null {
  const code = normaliseBarcode(text);
  if (code.length !== text.replace(/[\s-]/g, '').length) {
    return 'A barcode is digits only. Type the digits printed under the bars.';
  }
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) {
    return `A barcode has 8, 12 or 13 digits; this one has ${code.length}. Type the digits printed under the bars.`;
  }
  if (code.length !== 8 && !checkDigitOk(code)) {
    return 'Those digits do not check out, so one of them is probably wrong. Please read them off the packet again.';
  }
  return null;
}
