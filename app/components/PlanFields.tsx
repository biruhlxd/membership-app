import type { ReactNode } from "react";
import type { PlanFormErrors } from "../membership/plan";

export interface PlanDefaults {
  name: string;
  tag: string;
  joiningPrice: string;
  renewalPrice: string;
  interval: "MONTH" | "YEAR";
  intervalCount: string;
}

/**
 * The plan form's fields, shared by Create plan and the plan page: the Plan
 * section, then `product` (each page shows the product its own way), then
 * Pricing. A locked tag still submits through a hidden field.
 */
export function PlanFields({
  errors,
  defaults,
  tagLocked,
  product,
}: {
  errors: PlanFormErrors;
  defaults?: PlanDefaults;
  tagLocked?: string;
  product: ReactNode;
}) {
  return (
    <s-stack direction="block" gap="base">
      <s-section heading="Plan">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Plan name"
            name="name"
            placeholder="Coach membership"
            defaultValue={defaults?.name}
            details="Members see this name in the store and at checkout."
            error={errors.name}
          />
          <s-text-field
            label="Customer tag"
            name="tag"
            placeholder="member-coach"
            defaultValue={defaults?.tag}
            disabled={Boolean(tagLocked)}
            details={
              tagLocked ??
              "Members get this tag while they have access, and lose it when it ends."
            }
            error={errors.tag}
          />
          {tagLocked && defaults && (
            <input type="hidden" name="tag" value={defaults.tag} />
          )}
        </s-stack>
      </s-section>

      <s-section heading="Product">{product}</s-section>

      <s-section heading="Pricing">
        <s-stack direction="block" gap="base">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-money-field
              label="Joining price"
              name="joiningPrice"
              min={0}
              defaultValue={defaults?.joiningPrice}
              details="Charged on the first order."
              error={errors.joiningPrice}
            />
            <s-money-field
              label="Renewal price"
              name="renewalPrice"
              min={0}
              defaultValue={defaults?.renewalPrice}
              details="Charged at every renewal."
              error={errors.renewalPrice}
            />
          </s-grid>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Renews every"
              name="intervalCount"
              defaultValue={defaults?.intervalCount ?? "1"}
              min={1}
              step={1}
              inputMode="numeric"
              error={errors.intervalCount}
            />
            <s-select
              label="Period"
              name="interval"
              value={defaults?.interval ?? "YEAR"}
              error={errors.interval}
            >
              <s-option value="YEAR">Years</s-option>
              <s-option value="MONTH">Months</s-option>
            </s-select>
          </s-grid>
        </s-stack>
      </s-section>
    </s-stack>
  );
}
