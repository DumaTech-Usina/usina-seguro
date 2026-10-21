/**
 * What every recognition of issuance carries besides the proposal: the policy
 * number (REQ-248) and the policy PDF (REQ-247). The bytes only have to be a
 * file — nothing but the number is ever read from it, and the number travels
 * as typed.
 */
const POLICY_PDF_BYTES = new TextEncoder().encode('%PDF-1.4 apolice de teste');

/** For the use case: `registerPolicy.execute(recognitionInput(...))`. */
export function recognitionInput(proposalId: string, userId: string, policyNumber: string) {
  return {
    proposalId,
    userId,
    policyNumber,
    document: { fileName: 'apolice.pdf', content: POLICY_PDF_BYTES },
  };
}

/** For `POST /policies`: the PDF base64-encoded, the author from the session. */
export function recognitionBody(proposalId: string, policyNumber: string) {
  return {
    proposalId,
    policyNumber,
    document: {
      fileName: 'apolice.pdf',
      content: Buffer.from(POLICY_PDF_BYTES).toString('base64'),
    },
  };
}
