import { Navigate } from "react-router-dom";

/** Legacy route — live unit control lives on Mission Control now. */
export function LiveControlPage() {
  return <Navigate to="/console" replace />;
}
