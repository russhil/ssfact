import { NotFoundPage } from "@/components/not-found-page";

/** Catches any URL that matches no route at all. */
export default function RootNotFound() {
  return <NotFoundPage what="page" backHref="/" backLabel="Dashboard" />;
}
