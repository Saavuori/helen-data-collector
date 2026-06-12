import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, subDays, parseISO } from 'date-fns';
import {
  Button,
  Spinner,
  Text,
  tokens,
  makeStyles,
  mergeClasses,
  shorthands,
} from '@fluentui/react-components';
import {
  ChevronLeft24Regular,
  ChevronRight24Regular,
  Flash24Regular,
  ArrowTrending24Regular,
  Calendar24Regular,
  ErrorCircle24Regular,
  Money24Regular,
  ArrowDown16Regular,
  ArrowUp16Regular,
  Clock20Regular,
} from '@fluentui/react-icons';

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXL,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalL,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  dateNav: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
  },
  dateInput: {
    background: 'none',
    border: 'none',
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    cursor: 'pointer',
    outline: 'none',
    fontFamily: tokens.fontFamilyBase,
    colorScheme: 'dark',
    padding: '2px',
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    background: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
  },
  statIcon: {
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '18px',
  },
  statIconEnergy: { background: 'rgba(196, 49, 75, 0.12)' },
  statIconSpot:   { background: 'rgba(220, 167, 11, 0.12)' },
  statIconCost:   { background: 'rgba(139, 92, 246, 0.12)' },
  chartCard: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    padding: tokens.spacingHorizontalXL,
    boxShadow: tokens.shadow4,
  },
  toggleRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
    marginBottom: tokens.spacingVerticalM,
  },
  togglePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '5px 14px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1.5px solid ${tokens.colorNeutralStroke1}`,
    background: 'transparent',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    fontFamily: tokens.fontFamilyBase,
    whiteSpace: 'nowrap',
  },
  togglePillEnergy: {
    ...shorthands.borderColor('#c4314b'),
    backgroundColor: 'rgba(196, 49, 75, 0.1)',
    color: '#c4314b',
  },
  togglePillSpot: {
    ...shorthands.borderColor('#dca70b'),
    backgroundColor: 'rgba(220, 167, 11, 0.1)',
    color: '#dca70b',
  },
  togglePillCost: {
    ...shorthands.borderColor('#8b5cf6'),
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    color: '#8b5cf6',
  },
  pillDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  centeredState: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: '80px 0',
    color: tokens.colorNeutralForeground3,
  },
  analyticsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalM,
  },
  analyticsCard: {
    background: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    padding: tokens.spacingHorizontalXL,
    boxShadow: tokens.shadow4,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  analyticsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: tokens.spacingVerticalS,
  },
});

// ── Custom tooltip ────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label, showSpot, showCost }: any) => {
  if (!active || !payload?.length) return null;
  const consumption = payload.find((p: any) => p.dataKey === 'consumption');
  const spot        = payload.find((p: any) => p.dataKey === 'spotPrice');
  const cost        = payload.find((p: any) => p.dataKey === 'cost');
  return (
    <div style={{
      background: 'rgba(20,20,30,0.97)',
      border: `1px solid ${tokens.colorNeutralStroke1}`,
      borderRadius: tokens.borderRadiusMedium,
      padding: '12px 16px',
      fontSize: tokens.fontSizeBase200,
      minWidth: '175px',
      boxShadow: tokens.shadow16,
    }}>
      <div style={{ color: tokens.colorNeutralForeground3, marginBottom: '8px', fontWeight: 600 }}>{label}</div>
      {consumption && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: '#c4314b' }}>
          <span>Consumption</span>
          <span style={{ fontWeight: 700 }}>{Number(consumption.value).toFixed(4)} kWh</span>
        </div>
      )}
      {showSpot && spot && spot.value != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: '#dca70b', marginTop: '4px' }}>
          <span>Spot (incl. VAT)</span>
          <span style={{ fontWeight: 700 }}>{Number(spot.value).toFixed(4)} c/kWh</span>
        </div>
      )}
      {showCost && cost && cost.value != null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', color: '#8b5cf6', marginTop: '4px' }}>
          <span>Cost</span>
          <span style={{ fontWeight: 700 }}>{Number(cost.value).toFixed(2)} €</span>
        </div>
      )}
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const ConsumptionChart: React.FC = () => {
  const styles = useStyles();
  const [selectedDate, setSelectedDate] = useState<string>(
    format(subDays(new Date(), 1), 'yyyy-MM-dd')
  );
  const [showConsumption, setShowConsumption] = useState(true);
  const [showSpotPrice,   setShowSpotPrice]   = useState(true);
  const [showCost,        setShowCost]        = useState(true);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['consumption', selectedDate],
    queryFn: async () => {
      const response = await axios.get('/consumption', {
        params: { start: selectedDate, stop: selectedDate, resolution: 'quarter' },
      });
      return response.data;
    },
  });

  const goToPrevDay = () =>
    setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'));
  const goToNextDay = () => {
    const next = subDays(parseISO(selectedDate), -1);
    if (next < new Date()) setSelectedDate(format(next, 'yyyy-MM-dd'));
  };

  const isToday     = selectedDate === format(new Date(), 'yyyy-MM-dd');
  const isYesterday = selectedDate === format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const dateLabel   = isToday ? 'Today' : isYesterday ? 'Yesterday' : format(parseISO(selectedDate), 'MMMM do, yyyy');

  const chartData = data?.series.map((item: any) => {
    const consumption = item.electricity ?? null;
    const spotPrice = item.electricity_spot_prices_vat ?? null;
    const cost = (consumption !== null && spotPrice !== null)
      ? (consumption * spotPrice) / 100
      : null;
    return {
      time:        format(new Date(item.start), 'HH:mm'),
      consumption,
      spotPrice,
      cost,
    };
  }) ?? [];

  const totalKwh = data?.series.reduce((s: number, i: any) => s + (i.electricity ?? 0), 0) ?? 0;
  
  const totalCost = data?.series.reduce((s: number, i: any) => {
    const consumption = i.electricity ?? 0;
    const spotPrice = i.electricity_spot_prices_vat ?? 0;
    return s + (consumption * spotPrice) / 100;
  }, 0) ?? 0;

  const avgPricePaid = totalKwh > 0 ? (totalCost / totalKwh) * 100 : 0;

  const avgSpot  = (() => {
    if (!data?.series) return null;
    const vals = data.series.map((i: any) => i.electricity_spot_prices_vat).filter((v: any) => v != null);
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null;
  })();

  // Min/Max Spot Prices
  const spotPrices = data?.series
    .map((item: any) => ({
      price: item.electricity_spot_prices_vat,
      time: format(new Date(item.start), 'HH:mm'),
    }))
    .filter((item: any) => item.price != null) ?? [];
  
  const minSpot = spotPrices.length
    ? spotPrices.reduce((min: any, cur: any) => (cur.price < min.price ? cur : min), spotPrices[0])
    : null;
  
  const maxSpot = spotPrices.length
    ? spotPrices.reduce((max: any, cur: any) => (cur.price > max.price ? cur : max), spotPrices[0])
    : null;

  // Peak Load (Power in kW = consumption in kWh divided by interval length in hours)
  const peakPower = (() => {
    if (!data?.series || data.series.length === 0) return null;
    let maxVal = -1.0;
    let maxTime = "";
    for (const item of data.series) {
      if (item.electricity != null && item.start && item.stop) {
        const start = new Date(item.start).getTime();
        const stop = new Date(item.stop).getTime();
        const hours = (stop - start) / (1000 * 3600);
        if (hours > 0) {
          const kw = item.electricity / hours;
          if (kw > maxVal) {
            maxVal = kw;
            maxTime = format(new Date(item.start), 'HH:mm');
          }
        }
      }
    }
    return maxVal >= 0 ? { kw: maxVal, time: maxTime } : null;
  })();

  return (
    <div className={mergeClasses(styles.section, 'animate-fade-in')}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <Text as="h2" size={600} weight="semibold" style={{ display: 'block' }}>Usage Insights</Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
            Detailed consumption for {dateLabel}
          </Text>
        </div>

        <div className={styles.headerRight}>
          {/* Date navigator */}
          <div className={styles.dateNav}>
            <Button appearance="subtle" icon={<ChevronLeft24Regular />} onClick={goToPrevDay} size="small" />
            <Calendar24Regular style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }} />
            <input
              type="date"
              value={selectedDate}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={e => setSelectedDate(e.target.value)}
              className={styles.dateInput}
            />
            <Button appearance="subtle" icon={<ChevronRight24Regular />} onClick={goToNextDay} disabled={isToday} size="small" />
          </div>

          {/* Summary stat cards */}
          {data && (
            <>
              <div className={styles.statCard}>
                <div className={mergeClasses(styles.statIcon, styles.statIconEnergy)}>
                  <Flash24Regular style={{ color: '#c4314b' }} />
                </div>
                <div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'block' }}>Total Usage</Text>
                  <Text size={400} weight="bold">{totalKwh.toFixed(2)} kWh</Text>
                </div>
              </div>
              <div className={styles.statCard}>
                <div className={mergeClasses(styles.statIcon, styles.statIconCost)}>
                  <Money24Regular style={{ color: '#8b5cf6' }} />
                </div>
                <div>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'block' }}>Total Cost</Text>
                  <Text size={400} weight="bold">{totalCost.toFixed(2)} €</Text>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Chart card */}
      <div className={styles.chartCard}>
        {/* Series toggles */}
        <div className={styles.toggleRow}>
          <button
            className={mergeClasses(styles.togglePill, showConsumption ? styles.togglePillEnergy : undefined)}
            onClick={() => setShowConsumption(v => !v)}
          >
            <span className={styles.pillDot} style={{ background: showConsumption ? '#c4314b' : tokens.colorNeutralForeground4 }} />
            Consumption (kWh)
          </button>
          <button
            className={mergeClasses(styles.togglePill, showSpotPrice ? styles.togglePillSpot : undefined)}
            onClick={() => setShowSpotPrice(v => !v)}
          >
            <span className={styles.pillDot} style={{ background: showSpotPrice ? '#dca70b' : tokens.colorNeutralForeground4 }} />
            Spot Price incl. VAT (c/kWh)
          </button>
          <button
            className={mergeClasses(styles.togglePill, showCost ? styles.togglePillCost : undefined)}
            onClick={() => setShowCost(v => !v)}
          >
            <span className={styles.pillDot} style={{ background: showCost ? '#8b5cf6' : tokens.colorNeutralForeground4 }} />
            Interval Cost (€)
          </button>
        </div>

        {isLoading ? (
          <div className={styles.centeredState}>
            <Spinner size="extra-large" />
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Loading consumption data…</Text>
          </div>
        ) : isError ? (
          <div className={styles.centeredState}>
            <ErrorCircle24Regular style={{ fontSize: '48px', color: tokens.colorPaletteRedForeground1 }} />
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>Failed to fetch consumption data.</Text>
          </div>
        ) : (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: showSpotPrice ? 60 : 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#c4314b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#c4314b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorSpot" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#dca70b" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#dca70b" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="time" stroke={tokens.colorNeutralForeground4} fontSize={11} tickLine={false} axisLine={false} interval={7} />
                <YAxis yAxisId="kwh" orientation="left"
                  stroke={showConsumption ? '#c4314b' : 'transparent'}
                  tick={{ fill: showConsumption ? tokens.colorNeutralForeground3 : 'transparent', fontSize: 11 }}
                  tickLine={false} axisLine={false} tickFormatter={v => `${v} kWh`} width={62} />
                {showSpotPrice && (
                  <YAxis yAxisId="spot" orientation="right" stroke="#dca70b"
                    tick={{ fill: tokens.colorNeutralForeground3, fontSize: 11 }}
                    tickLine={false} axisLine={false} tickFormatter={v => `${v} c`} width={52} />
                )}
                <Tooltip content={<CustomTooltip showSpot={showSpotPrice} showCost={showCost} />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />

                {showConsumption && (
                  <Area yAxisId="kwh" type="monotone" dataKey="consumption"
                    stroke="#c4314b" strokeWidth={2.5} fillOpacity={1} fill="url(#colorUsage)"
                    dot={false} activeDot={{ r: 4, fill: '#c4314b', strokeWidth: 0 }} connectNulls />
                )}
                {showCost && (
                  <Bar yAxisId="kwh" dataKey="cost" fill="#8b5cf6" fillOpacity={0.15} stroke="#8b5cf6" strokeWidth={1} radius={[2, 2, 0, 0]} />
                )}
                {showSpotPrice && (
                  <Line yAxisId="spot" type="monotone" dataKey="spotPrice"
                    stroke="#dca70b" strokeWidth={1.8} dot={false}
                    activeDot={{ r: 4, fill: '#dca70b', strokeWidth: 0 }} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Detailed Analytics Grid */}
      {data && (
        <div className={styles.analyticsGrid}>
          {/* Card 1: Cost Performance */}
          <div className={styles.analyticsCard}>
            <div className={styles.analyticsHeader}>
              <Money24Regular style={{ color: '#8b5cf6', fontSize: '20px' }} />
              <Text size={300} weight="semibold">Cost Performance</Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Average Price Paid</Text>
                <Text size={300} weight="bold" style={{ color: '#8b5cf6' }}>{avgPricePaid.toFixed(2)} c/kWh</Text>
              </div>
              {avgSpot != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Market Avg Spot</Text>
                  <Text size={300} weight="semibold">{avgSpot.toFixed(2)} c/kWh</Text>
                </div>
              )}
              {avgSpot != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: '6px', marginTop: '2px' }}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Optimization Ratio</Text>
                  <Text size={300} weight="bold" style={{ color: avgPricePaid <= avgSpot ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
                    {avgPricePaid <= avgSpot
                      ? `-${((1 - avgPricePaid / avgSpot) * 100).toFixed(1)}% cheaper`
                      : `+${((avgPricePaid / avgSpot - 1) * 100).toFixed(1)}% expensive`
                    }
                  </Text>
                </div>
              )}
            </div>
          </div>

          {/* Card 2: Load / Peak Demand */}
          <div className={styles.analyticsCard}>
            <div className={styles.analyticsHeader}>
              <Flash24Regular style={{ color: '#c4314b', fontSize: '20px' }} />
              <Text size={300} weight="semibold">Peak Demand</Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {peakPower ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Peak Load (Power)</Text>
                    <Text size={300} weight="bold" style={{ color: '#c4314b' }}>{peakPower.kw.toFixed(2)} kW</Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>Peak Load Time</Text>
                    <Text size={300} weight="semibold" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock20Regular style={{ fontSize: '14px', color: tokens.colorNeutralForeground3 }} />
                      {peakPower.time}
                    </Text>
                  </div>
                </>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground4 }}>No peak load data available</Text>
              )}
            </div>
          </div>

          {/* Card 3: Spot Price Range */}
          <div className={styles.analyticsCard}>
            <div className={styles.analyticsHeader}>
              <ArrowTrending24Regular style={{ color: '#dca70b', fontSize: '20px' }} />
              <Text size={300} weight="semibold">Spot Price Range</Text>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {minSpot && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ArrowDown16Regular style={{ color: tokens.colorPaletteGreenForeground1 }} />
                    Minimum Price
                  </Text>
                  <div>
                    <Text size={300} weight="semibold" style={{ color: tokens.colorPaletteGreenForeground1 }}>{minSpot.price.toFixed(2)} c</Text>
                    <Text size={100} style={{ color: tokens.colorNeutralForeground4, marginLeft: '6px' }}>at {minSpot.time}</Text>
                  </div>
                </div>
              )}
              {maxSpot && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ArrowUp16Regular style={{ color: tokens.colorPaletteRedForeground1 }} />
                    Maximum Price
                  </Text>
                  <div>
                    <Text size={300} weight="semibold" style={{ color: tokens.colorPaletteRedForeground1 }}>{maxSpot.price.toFixed(2)} c</Text>
                    <Text size={100} style={{ color: tokens.colorNeutralForeground4, marginLeft: '6px' }}>at {maxSpot.time}</Text>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConsumptionChart;