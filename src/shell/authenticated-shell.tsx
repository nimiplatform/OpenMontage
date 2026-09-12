import { ProductArea } from './routes/product-area.js';

// The protected gate owns platform access; Backlot owns its production canvas.
export function AuthenticatedShell() {
  return (
    <div
      className="app-shell"
      data-testid="nimi-app-shell"
    >
      <ProductArea />
    </div>
  );
}
