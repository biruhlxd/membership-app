import type { ReactNode } from "react";
import type { PlanFormErrors } from "../membership/plan";
import type { SeatType } from "../membership/organizations";

export interface PlanDefaults {
  name: string;
  tag: string;
  joiningPrice: string;
  renewalPrice: string;
  interval: "MONTH" | "YEAR";
  intervalCount: string;
  memberDiscount: string;
  seatTypes?: SeatType[];
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

      <s-section heading="Organization seats">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Leave empty for a membership for one person. Add seat types to sell
            this plan to organizations such as clubs or schools: the buyer
            becomes the organization&apos;s admin and invites people into these
            seats from their account. Each seat gives its holder the seat
            type&apos;s tag while the organization&apos;s membership is active.
          </s-paragraph>
          {[0, 1, 2].map((i) => {
            const seat = defaults?.seatTypes?.[i];
            return (
              <s-grid key={i} gridTemplateColumns="2fr 2fr 1fr" gap="base">
                <s-text-field
                  label="Seat type"
                  name={`seatName${i}`}
                  placeholder={i === 0 ? "Coach" : undefined}
                  defaultValue={seat?.name ?? ""}
                />
                <s-text-field
                  label="Tag for seat holders"
                  name={`seatTag${i}`}
                  placeholder={i === 0 ? "member-coach" : undefined}
                  defaultValue={seat?.tag ?? ""}
                />
                <s-number-field
                  label="Seats"
                  name={`seatCount${i}`}
                  min={1}
                  step={1}
                  inputMode="numeric"
                  defaultValue={seat ? String(seat.seats) : ""}
                />
              </s-grid>
            );
          })}
        </s-stack>
      </s-section>

      <s-section heading="Member pricing">
        <s-number-field
          label="Member discount (%)"
          name="memberDiscount"
          defaultValue={defaults?.memberDiscount ?? ""}
          min={1}
          max={100}
          step={1}
          inputMode="numeric"
          details="Members get this much off everything else they buy, while they have the plan's tag. Leave empty for no member price."
          error={errors.memberDiscount}
        />
      </s-section>
    </s-stack>
  );
}
