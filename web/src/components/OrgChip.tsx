import { ACCOUNT_TYPES, ORG_CHIP, type AccountType } from '../lib/accounts';

// Shows what kind of organisation posted. Renders nothing for individuals. Until an organisation is
// verified, the chip is grey and says so, because anyone can claim a type when signing up.
export function OrgChip({ type, verified = true, className = '' }: { type: AccountType | null | undefined; verified?: boolean; className?: string }) {
  if (!type || type === 'individual') return null;
  const { label, cls } = ORG_CHIP[type];
  const Icon = ACCOUNT_TYPES[type].icon;
  return (
    <span title={verified ? undefined : 'Organisation not verified yet'}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${verified ? cls : 'bg-sand text-muted'} ${className}`}>
      <Icon size={11} strokeWidth={2.5} /> {label}{verified ? '' : ' · unverified'}
    </span>
  );
}
