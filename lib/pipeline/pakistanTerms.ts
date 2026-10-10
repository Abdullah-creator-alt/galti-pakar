/**
 * Editable list of Pakistan and policy terms that signal concrete, specific writing.
 * Terms of three letters or fewer (acronyms) match case-sensitively; longer ones ignore case.
 */
export const PAKISTAN_TERMS: string[] = [
  "NFC Award", "18th Amendment", "State Bank of Pakistan", "SBP", "IMF", "CPEC", "FATA", "Article 25A", "Article 6",
  "Indus Waters Treaty", "Indus", "Tarbela", "Mangla", "Diamer-Bhasha", "Kalabagh", "FBR", "Federal Board of Revenue",
  "NAB", "Constitution of 1973", "Objectives Resolution", "Simla Agreement", "Tashkent", "Lahore Declaration", "Kashmir",
  "Gwadar", "Balochistan", "Khyber Pakhtunkhwa", "Sindh", "Punjab", "Gilgit-Baltistan", "Karachi", "Lahore", "Peshawar",
  "National Action Plan", "Zarb-e-Azb", "Radd-ul-Fasaad", "TTP", "Durand Line", "SAARC", "SCO", "FATF", "GSP Plus",
  "Planning Commission", "Vision 2025", "Ehsaas", "BISP", "Benazir Income Support", "Higher Education Commission", "HEC",
  "WAPDA", "NEPRA", "circular debt", "Council of Common Interests", "Kartarpur", "Afghan refugees", "Madrassa",
  "Quaid-e-Azam", "Jinnah", "Liaquat", "Ayub Khan", "Zia", "Bhutto", "Musharraf", "Sir Syed", "Allama Iqbal",
  "Pakistan Penal Code", "Hudood", "Blasphemy", "Zakat", "Ushr", "Sui gas", "Thar", "Reko Diq", "Saindak", "Tharparkar",
  "Pakistan Economic Survey", "Economic Survey", "Karakoram", "Hindu Kush", "Eurobond", "Sukuk", "PSDP", "ADP", "NDMA", "PDMA",
];

const compiled = PAKISTAN_TERMS.map((term) => {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`, term.length <= 3 ? "" : "i");
});

/** Number of distinct listed terms found in the text. */
export function countPakistanTerms(text: string): number {
  let n = 0;
  for (const re of compiled) if (re.test(text)) n++;
  return n;
}
