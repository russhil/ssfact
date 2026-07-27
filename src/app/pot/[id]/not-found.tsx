import { NotFoundPage } from "@/components/not-found-page";

export default function PotNotFound() {
  return <NotFoundPage what="trim purchase order" backHref="/trim-orders" backLabel="Trim orders" />;
}
