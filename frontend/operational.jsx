import { createRoot } from 'react-dom/client';
import { Navigate } from 'react-router-dom';
import './fonts.css';
import './src/polymet.css';
import './standards.css';
import { PosShell } from './src/pos-shell.jsx';
import { InventoryPage } from './src/polymet/pages/inventory-page.jsx';
import { OperationalStoreProvider } from './src/data/operational-store.jsx';
import { createPosClient } from './src/data/pos-client.js';

const client = createPosClient();
function InventoryHome() {
  return <Navigate to="/inventario" replace />;
}
createRoot(document.getElementById('root')).render(
  <OperationalStoreProvider client={client}>
    <PosShell pages={{ '/': InventoryHome, '/inventario': InventoryPage }} />
  </OperationalStoreProvider>
);
