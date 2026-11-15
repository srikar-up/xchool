import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, MapPin, Sparkles, UserRound } from 'lucide-react';
import { useStudentData } from '../context/StudentDataContext';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import PageHead from '../components/PageHead';
import { formatDateLong, formatTime, timeToMinutes } from '../lib/format';
import { getTimetableConfig, weekDatesForDays } from '../lib/timetable';

export default function Timetable() {
  const { data } = useStudentData();
  const config = useMemo(() => getTimetableConfig(data), [data]);
  const dates = useMemo(() => weekDatesForDays(config.days), [config.days]);
  const today = new Date().getDay();
  const initial = config.days.includes(today) ? today : config.days[0];
  const [day, setDay] = useState(initial);

  useEffect(() => {
    if (!config.days.includes(day)) setDay(config.days[0]);
  }, [day, config.days]);

  const selected = dates.find((entry) => entry.value === day);
  const periods = data.timetable
    .filter((period) => period.dayOfWeek === day)
    .sort((a, b) => a.periodNumber - b.periodNumber);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = selected?.isToday;

  return (
    <div className="t-page">
      <PageHead
        eyebrow="Weekly schedule"
        title="Timetable"
        subtitle={selected ? formatDateLong(selected.date, { year: 'numeric' }) : ''}
        action={isToday ? <Badge tone="brand" icon={Sparkles}>Today</Badge> : null}
      />

      <div className="week-strip" role="tablist" aria-label="Choose day">
        {dates.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={entry.value === day}
            className={`week-day ${entry.value === day ? 'active' : ''} ${entry.isToday ? 'today' : ''}`}
            onClick={() => setDay(entry.value)}
          >
            <span>{entry.short}</span>
            <strong>{entry.date.getDate()}</strong>
            {entry.isToday ? <i /> : null}
          </button>
        ))}
      </div>

      <div className="scope-strip">
        <span>
          <CalendarDays size={15} /> {periods.length} periods on {selected?.label}
        </span>
        <span>{data.subjects.length} subjects this term</span>
      </div>

      {periods.length ? (
        <div className="timeline-list">
          {periods.map((period) => {
            const live =
              isToday &&
              nowMinutes >= timeToMinutes(period.startTime) &&
              nowMinutes <= timeToMinutes(period.endTime);
            const done = isToday && nowMinutes > timeToMinutes(period.endTime);
            return (
              <article
                key={period.id}
                className={`timeline-period ${live ? 'live' : ''} ${done ? 'done' : ''}`}
              >
                <div className="timeline-time">
                  <strong>{formatTime(period.startTime).replace(' ', '')}</strong>
                  <span>{formatTime(period.endTime).replace(' ', '')}</span>
                </div>
                <div className="timeline-rail">
                  <span className="timeline-dot" />
                </div>
                <div className="timeline-card">
                  <div className="timeline-card-top">
                    <h3>{period.subject}</h3>
                    {live ? (
                      <Badge tone="success" icon={Sparkles}>
                        Live now
                      </Badge>
                    ) : done ? (
                      <Badge tone="neutral">Done</Badge>
                    ) : (
                      <Badge tone="brand">Period {period.periodNumber}</Badge>
                    )}
                  </div>
                  <div className="timeline-meta">
                    <span>
                      <UserRound size={13} /> {period.teacherName || 'Teacher'}
                    </span>
                    <span>
                      <MapPin size={13} /> {period.room}
                    </span>
                    {period.isLab ? <span className="lab-tag">Lab</span> : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="No periods"
          message="There are no scheduled periods on this day."
        />
      )}

      <div className="timetable-note">
        <Clock3 size={15} />
        <span>Times use the school’s local timezone. Live periods are highlighted today only.</span>
      </div>
    </div>
  );
}
