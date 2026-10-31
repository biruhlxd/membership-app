(() => {
  // Copies the chosen plan into every add-to-cart form in the same section as
  // a hidden `selling_plan` field, so Add to cart and Buy it now both send it.
  function sync(picker) {
    const checked = picker.querySelector('input[type="radio"]:checked');
    const value = checked ? checked.value : "";
    const scope = picker.closest(".shopify-section") || document;
    scope.querySelectorAll('form[action*="/cart/add"]').forEach((form) => {
      let input = form.querySelector('input[name="selling_plan"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "selling_plan";
        form.appendChild(input);
      }
      if (input.value !== value) input.value = value;
    });
  }

  function init() {
    document.querySelectorAll("[data-membership-plans]").forEach((picker) => {
      if (picker.dataset.membershipReady) return;
      picker.dataset.membershipReady = "true";
      picker.addEventListener("change", () => sync(picker));
      sync(picker);
      // Themes re-render the product form on variant change; put the field back.
      const scope = picker.closest(".shopify-section");
      if (scope) {
        new MutationObserver(() => sync(picker)).observe(scope, {
          childList: true,
          subtree: true,
        });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  document.addEventListener("shopify:section:load", init);
})();
