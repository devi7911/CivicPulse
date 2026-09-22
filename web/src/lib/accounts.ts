import { Building2, GraduationCap, HandHeart, Landmark, Store, User, Users, type LucideIcon } from 'lucide-react';

export type AccountType = 'individual' | 'community' | 'ngo' | 'education' | 'business' | 'government';

export const ACCOUNT_TYPES: Record<AccountType, { label: string; hint: string; icon: LucideIcon; orgLabel?: string }> = {
  individual: { label: 'Individual', hint: 'A resident reporting and helping', icon: User },
  community: { label: 'Community group', hint: 'Resident welfare association, colony or volunteer group', icon: Users, orgLabel: 'Group or association name' },
  ngo: { label: 'NGO / non-profit', hint: 'Registered charity, trust or society', icon: HandHeart, orgLabel: 'Organisation name' },
  education: { label: 'School or college', hint: 'Students, NSS or eco clubs', icon: GraduationCap, orgLabel: 'Institution name' },
  business: { label: 'Local business', hint: 'Shops, offices and companies doing civic work', icon: Store, orgLabel: 'Business name' },
  government: { label: 'Government body', hint: 'Department or ward office', icon: Landmark, orgLabel: 'Department or office name' },
};

export const isOrg = (t: AccountType | null | undefined) => Boolean(t && t !== 'individual');

// Short chip label and colours for organisation accounts. Individuals get no chip.
export const ORG_CHIP: Record<Exclude<AccountType, 'individual'>, { label: string; cls: string }> = {
  community: { label: 'Community group', cls: 'bg-emerald-100 text-emerald-800' },
  ngo: { label: 'NGO', cls: 'bg-rose-100 text-rose-800' },
  education: { label: 'School / college', cls: 'bg-violet-100 text-violet-800' },
  business: { label: 'Business', cls: 'bg-amber-100 text-amber-800' },
  government: { label: 'Government', cls: 'bg-sky-100 text-sky-800' },
};
export const OrgIcon = Building2;

// Indian mobile: 10 digits starting 6-9, with or without +91.
export function validIndianMobile(p: string): boolean {
  const d = p.replace(/[^0-9]/g, '');
  return /^[6-9][0-9]{9}$/.test(d) || /^91[6-9][0-9]{9}$/.test(d);
}
