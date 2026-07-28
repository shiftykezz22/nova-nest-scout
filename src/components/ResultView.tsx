import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import type { CalcInputs } from "@/lib/calc";
import { ResultTabs } from "./ResultTabs";

type Props = {
  product: ProductData;
  onProductChange: (patch: Partial<ProductData>) => void;
  scanId?: string;
  initialSuppliers?: Supplier[];
  settings?: Partial<CalcInputs>;
};

export function ResultView({ product, onProductChange, scanId, initialSuppliers, settings }: Props) {
  return <ResultTabs product={product} onProductChange={onProductChange} scanId={scanId} initialSuppliers={initialSuppliers} settings={settings} />;
}