// Customer-facing order status text messages. Sent through the same SMS
// provider as OTPs (IPROG SMS in prod); kept inside 160 chars so one SMS
// segment carries the whole update.
const STATUS_TEXTS = {
  pending: "was received. The kitchen will confirm shortly.",
  confirmed: "is confirmed.",
  preparing: "is being prepared.",
  delivering: "is out for delivery. Please be ready.",
  delivered: "was delivered. Thank you!",
  cancelled: "was cancelled."
};

export function statusSmsText(orderNumber, status) {
  const tail = STATUS_TEXTS[status] || `status: ${status}`;
  return `MDNGHT K-RAVINGS: Order ${orderNumber} ${tail}`;
}
