import { LegalDocument } from '@/components/LegalDocument';

const PARAGRAPHS = [
  'legal.termsIntro',
  'legal.termsAccounts',
  'legal.termsNoMoney',
  'legal.termsContent',
  'legal.termsAcceptableUse',
  'legal.termsAvailability',
  'legal.termsLiability',
  'legal.termsChanges',
  'legal.termsGoverningLaw',
  'legal.termsContact',
] as const;

export default function TermsScreen() {
  return <LegalDocument updatedKey="legal.termsUpdated" paragraphKeys={[...PARAGRAPHS]} />;
}
