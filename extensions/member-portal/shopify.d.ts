import '@shopify/ui-extensions';

// Shopify's extension template needs @ts-ignore here (the module path is a
// source file, not a package).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
declare module './src/MemberPortal.jsx' {
  const shopify: import('@shopify/ui-extensions/customer-account.page.render').Api;
  const globalThis: { shopify: typeof shopify };
}
