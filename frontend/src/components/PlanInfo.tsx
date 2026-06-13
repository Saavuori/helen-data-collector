import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Spinner,
  Text,
  Badge,
  tokens,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import {
  BoxMultiple24Regular,
  Info16Regular,
  Tag16Regular,
  Money24Regular,
} from '@fluentui/react-icons';

// ── helpers ──────────────────────────────────────────────────────────────────

const en = (obj: any): string =>
  obj?.en ?? obj?.fi ?? Object.values(obj ?? {})[0] ?? '';

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXL,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: tokens.spacingHorizontalXL,
  },
  card: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    padding: tokens.spacingVerticalXL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    boxShadow: tokens.shadow4,
    transition: 'box-shadow 0.18s ease, border-color 0.18s ease',
    ':hover': {
      boxShadow: tokens.shadow8,
      ...shorthands.borderColor(tokens.colorNeutralStroke1),
    },
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  cardHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  iconBox: {
    background: `linear-gradient(135deg, ${tokens.colorBrandBackground}, ${tokens.colorBrandBackground2})`,
    padding: '10px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: tokens.shadow4,
    fontSize: '20px',
    color: 'white',
  },
  badgesRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    justifyContent: 'flex-end',
  },
  descBox: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    alignItems: 'flex-start',
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: tokens.fontWeightSemibold,
  },
  priceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  priceRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid transparent',
    gap: '1rem',
  },
  priceRowBase: {
    backgroundColor: 'rgba(220, 167, 11, 0.06)',
    ...shorthands.borderColor('rgba(220, 167, 11, 0.2)'),
  },
  priceRowUsage: {
    backgroundColor: 'rgba(196, 49, 75, 0.06)',
    ...shorthands.borderColor('rgba(196, 49, 75, 0.2)'),
  },
  cardFooter: {
    display: 'flex',
    gap: tokens.spacingHorizontalXL,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    flexWrap: 'wrap',
  },
  footerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  centeredState: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

// ── PriceRow ──────────────────────────────────────────────────────────────────

interface PriceRowProps {
  label: string;
  price: number;
  unit: string;
  postfix?: string | null;
  isBase?: boolean;
}
const PriceRowItem: React.FC<PriceRowProps> = ({ label, price, unit, postfix, isBase }) => {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.priceRow, isBase ? styles.priceRowBase : styles.priceRowUsage)}>
      <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>{label}</Text>
      <span>
        <Text size={300} weight="bold" style={{ color: isBase ? '#dca70b' : '#c4314b' }}>
          {price} {unit}
        </Text>
        {postfix && (
          <Text size={200} style={{ color: tokens.colorNeutralForeground4, marginLeft: '4px' }}>
            {postfix}
          </Text>
        )}
      </span>
    </div>
  );
};

// ── PlanInfo ──────────────────────────────────────────────────────────────────

const PlanInfo: React.FC = () => {
  const styles = useStyles();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await axios.get('products');
      return res.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  if (isLoading) {
    return (
      <div className={styles.centeredState}>
        <Spinner size="large" label="Loading plan details…" />
      </div>
    );
  }

  if (isError || !data?.length) return null;

  return (
    <div className={mergeClasses(styles.section, 'animate-fade-in')}>
      <div>
        <Text as="h2" size={600} weight="semibold" style={{ display: 'block' }}>Electricity Plan</Text>
        <Text size={300} style={{ color: tokens.colorNeutralForeground3, marginTop: '4px', display: 'block' }}>
          Your current contract details
        </Text>
      </div>

      <div className={styles.grid}>
        {data.map((product: any) => {
          const name        = en(product.localized_name) || product.name;
          const description = en(product.product_description?.text);
          const subtypes    = product.product_subtypes ?? [];
          const startDate   = product.start_date;

          return (
            <div key={product.id} className={styles.card}>
              {/* Header */}
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderLeft}>
                  <div className={styles.iconBox}>
                    <BoxMultiple24Regular />
                  </div>
                  <div>
                    <Text size={400} weight="semibold" style={{ display: 'block' }}>{name}</Text>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>ID: {product.id}</Text>
                  </div>
                </div>
                <div className={styles.badgesRow}>
                  {subtypes.map((s: string) => (
                    <Badge key={s} appearance="tint" color="brand" shape="rounded">{s}</Badge>
                  ))}
                </div>
              </div>

              {/* Description */}
              {description && (
                <div className={styles.descBox}>
                  <Info16Regular style={{ color: tokens.colorNeutralForeground3, flexShrink: 0, marginTop: '2px' }} />
                  <Text size={200} style={{ color: tokens.colorNeutralForeground2, lineHeight: 1.6 }}>
                    {description}
                  </Text>
                </div>
              )}

              {/* Pricing components */}
              <div>
                <div className={styles.sectionLabel}>
                  <Money24Regular style={{ fontSize: '14px' }} />
                  Pricing Components
                </div>
                <div className={styles.priceList}>
                  {product.components?.map((comp: any) => (
                    <PriceRowItem
                      key={comp.id}
                      label={en(comp.localized_name) || comp.name}
                      price={comp.price}
                      unit={en(comp.localized_price_unit) || comp.price_unit}
                      postfix={en(comp.price_postfix) || null}
                      isBase={comp.is_base_price}
                    />
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className={styles.cardFooter}>
                <div className={styles.footerItem}>
                  <Tag16Regular style={{ color: tokens.colorNeutralForeground4 }} />
                  <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>
                    {en(product.localized_name) || product.product_type}
                  </Text>
                </div>
                <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>
                  Active since:{' '}
                  <Text size={200} weight="semibold" style={{ color: tokens.colorNeutralForeground2 }}>
                    {fmt(startDate)}
                  </Text>
                </Text>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlanInfo;
