import { classifyCategory } from './finance.js';

const NON_CONSUMPTION_OPERATION_TYPES = new Set([
  'TED','DOC','TRANSFERENCIA_MESMA_INSTITUICAO','PAGAMENTO_FATURA',
  'RESGATE_APLIC_FINANCEIRA','RENDIMENTO_APLIC_FINANCEIRA','PORTABILIDADE_SALARIO'
]);

function absoluteCents(value) {
  const n = Math.abs(Number(value));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function signedCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function isNonConsumption(raw) {
  const operation = String(raw?.operationType || '').toUpperCase();
  if (NON_CONSUMPTION_OPERATION_TYPES.has(operation)) return true;
  const text = `${raw?.description || ''} ${raw?.descriptionRaw || ''}`.toLowerCase();
  return /pagamento (?:de )?fatura|paguei? fatura|transfer[eê]ncia entre contas|resgate (?:de )?aplica|aplica[cç][aã]o financeira/.test(text);
}

export function isEffectiveTransaction(tx) {
  if (tx?.reconciliationStatus === 'reconciled') return false;
  if (tx?.isConsumption === false) return false;
  return true;
}

export function normalizePluggyTransaction(raw, account) {
  if (!raw?.id) throw new Error('missing_provider_transaction_id');
  if (!['DEBIT','CREDIT'].includes(raw.type)) throw new Error('unsupported_transaction_type');
  const merchantName = raw?.merchant?.name || null;
  const description = merchantName || raw.description || raw.descriptionRaw || 'Transação bancária';
  const classifierText = `${description} ${raw.description || ''}`.trim();
  return {
    type: raw.type === 'DEBIT' ? 'expense' : 'income',
    amountCents: absoluteCents(raw.amount),
    description,
    category: raw.type === 'DEBIT' ? classifyCategory(classifierText) : 'Entradas',
    occurredAt: new Date(raw.date).toISOString(),
    provider:'pluggy',
    providerTransactionId:raw.id,
    bankAccountId:account.id,
    externalStatus:raw.status || null,
    merchantName,
    reconciliationStatus:'unmatched',
    isConsumption: !isNonConsumption(raw)
  };
}

export function findBestReconciliationCandidate(imported, candidates) {
  const eligible = (candidates || []).filter(c =>
    ['manual','voice'].includes(c.source || 'manual') &&
    c.reconciliationStatus !== 'reconciled' &&
    c.type === imported.type &&
    Number(c.amountCents) === Number(imported.amountCents) &&
    Math.abs(new Date(c.occurredAt).getTime() - new Date(imported.occurredAt).getTime()) <= 3 * 86400000
  );
  if (eligible.length === 1) return { status:'matched', candidate:eligible[0] };
  if (eligible.length > 1) return { status:'possible_duplicate', candidate:null };
  return { status:'unmatched', candidate:null };
}

function accountToStore(raw, connection, now) {
  return {
    connectionId:connection.id,
    providerAccountId:raw.id,
    type:raw.type || null,
    subtype:raw.subtype || null,
    name:raw.name || raw.marketingName || null,
    institutionName:connection.institutionName || null,
    currency:raw.currencyCode || 'BRL',
    balanceCents:signedCents(raw.balance),
    creditLimitCents:raw?.creditData?.creditLimit == null ? null : absoluteCents(raw.creditData.creditLimit),
    lastSyncedAt:now.toISOString(),
    rawMetadata:{ marketingName:raw.marketingName || null, number:raw.number || null }
  };
}

export async function syncConnection({ userId, connection, store, pluggy, now=new Date() }) {
  const startedAt = now.toISOString();
  let accountsSeen = 0;
  let transactionsSeen = 0;
  let transactionsInserted = 0;
  let transactionsUpdated = 0;
  try {
    const item = await pluggy.getItem(connection.providerItemId);
    const itemStatus = item?.status || connection.status || 'UNKNOWN';
    if (['LOGIN_ERROR','ACCOUNT_NEEDS_ACTION','ACCOUNT_NEEDS_AUTHORIZATION','CONSENT_EXPIRED'].includes(itemStatus)) {
      await store.upsertBankConnection(userId, { ...connection, status:itemStatus, lastErrorCode:itemStatus, lastErrorMessage:'Ação necessária na instituição.' });
      await store.recordSyncRun(userId, { connectionId:connection.id, startedAt, finishedAt:now.toISOString(), status:'action_required', errorCode:itemStatus });
      return { accountsSeen:0, transactionsSeen:0, status:'action_required' };
    }

    const rawAccounts = await pluggy.listAccounts(connection.providerItemId);
    accountsSeen = rawAccounts.length;
    for (const rawAccount of rawAccounts) {
      const account = await store.upsertBankAccount(userId, accountToStore(rawAccount, connection, now));
      const rawTransactions = await pluggy.listTransactions(rawAccount.id);
      for (const raw of rawTransactions) {
        transactionsSeen++;
        const normalized = normalizePluggyTransaction(raw, account);
        const candidates = normalized.type === 'expense' && normalized.isConsumption
          ? await store.findReconciliationCandidates(userId, normalized)
          : [];
        const match = findBestReconciliationCandidate(normalized, candidates);
        normalized.reconciliationStatus = match.status;
        const existed = typeof store.getImportedTransactionByProviderId === 'function'
          ? await store.getImportedTransactionByProviderId(userId, normalized.provider, normalized.providerTransactionId)
          : null;
        const bankTx = await store.upsertImportedTransaction(userId, normalized);
        if (existed) transactionsUpdated++; else transactionsInserted++;
        if (match.status === 'matched' && match.candidate && match.candidate.reconciliationStatus !== 'reconciled') {
          await store.markReconciled(userId, match.candidate.id, bankTx.id);
        }
      }
    }

    const completedAt = now.toISOString();
    await store.upsertBankConnection(userId, {
      ...connection, status:itemStatus, institutionName:item?.connector?.name || connection.institutionName || null,
      lastSyncAt:completedAt, lastErrorCode:null, lastErrorMessage:null
    });
    await store.recordSyncRun(userId, { connectionId:connection.id, startedAt, finishedAt:completedAt, status:'success', accountsSeen, transactionsSeen, transactionsInserted, transactionsUpdated });
    return { accountsSeen, transactionsSeen, transactionsInserted, transactionsUpdated, status:'success' };
  } catch (err) {
    await store.recordSyncRun(userId, {
      connectionId:connection.id, startedAt, finishedAt:now.toISOString(), status:'failed',
      accountsSeen, transactionsSeen, transactionsInserted, transactionsUpdated, errorCode:err?.code || 'SYNC_FAILED'
    }).catch(()=>{});
    throw err;
  }
}