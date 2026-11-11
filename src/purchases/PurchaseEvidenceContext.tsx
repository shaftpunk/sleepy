import { createContext, useContext } from "react";
import { EMPTY_PURCHASE_EVIDENCE } from "./revenueCatModel";
export const PurchaseEvidenceContext = createContext(EMPTY_PURCHASE_EVIDENCE);
export function usePurchaseEvidence() { return useContext(PurchaseEvidenceContext); }
