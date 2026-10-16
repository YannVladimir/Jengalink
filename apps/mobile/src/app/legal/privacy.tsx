import { LegalDocument } from '@/components/LegalDocument';

const PARAGRAPHS = [
  'legal.privacyIntro',
  'legal.privacyWhatWeCollect',
  'legal.privacyHowWeUseIt',
  'legal.privacyWhoSeesIt',
  'legal.privacyMoney',
  'legal.privacyStorage',
  'legal.privacyRetention',
  'legal.privacyYourRights',
  'legal.privacyContact',
] as const;

export default function PrivacyScreen() {
  return <LegalDocument updatedKey="legal.privacyUpdated" paragraphKeys={[...PARAGRAPHS]} />;
}
