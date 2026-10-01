"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export type FilterOption = { value: string; label: string };

type ContentHeaderProps = {
  title: string;
  primaryAction?: { label: string; href?: string; onClick?: () => void };
  searchPlaceholder?: string;
  showFilter?: boolean;
  /** Controlled search: when provided, search input filters the list */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Filter dropdown options and selection */
  filterOptions?: FilterOption[];
  selectedFilter?: string;
  onFilterChange?: (value: string) => void;
  /** Settings: rows per page (for table views) */
  pageSizeOptions?: number[];
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  showSettingsLink?: boolean;
};

export default function ContentHeader({
  title,
  primaryAction,
  searchPlaceholder = "Search",
  showFilter = true,
  searchValue = "",
  onSearchChange,
  filterOptions = [],
  selectedFilter,
  onFilterChange,
  pageSizeOptions = [],
  pageSize,
  onPageSizeChange,
  showSettingsLink = true,
}: ContentHeaderProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [internalSearch, setInternalSearch] = useState("");
  const filterRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const search = onSearchChange !== undefined ? searchValue : internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (filterRef.current && !filterRef.current.contains(target)) setFilterOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(target)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
        {primaryAction &&
          (primaryAction.href ? (
            <Link
              href={primaryAction.href}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <PlusIcon className="h-4 w-4" />
              {primaryAction.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              <PlusIcon className="h-4 w-4" />
              {primaryAction.label}
            </button>
          ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-search"
          />
        </div>
        {showFilter && (filterOptions.length > 0 || onFilterChange) && (
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => { setFilterOpen((o) => !o); setSettingsOpen(false); }}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--sidebar-bg)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-200"
            >
              <FilterIcon className="h-4 w-4" />
              Filter
              {selectedFilter && filterOptions.find((o) => o.value === selectedFilter) && (
                <span className="rounded bg-[var(--accent)]/20 px-1.5 text-xs text-[var(--accent)]">
                  {filterOptions.find((o) => o.value === selectedFilter)?.label}
                </span>
              )}
            </button>
            {filterOpen && filterOptions.length > 0 && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg">
                {filterOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { onFilterChange?.(opt.value); setFilterOpen(false); }}
                    className={`block w-full px-3 py-2 text-left text-sm ${selectedFilter === opt.value ? "bg-[var(--accent)]/10 font-medium text-[var(--accent)]" : "text-[var(--text)] hover:bg-gray-100"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => { setSettingsOpen((o) => !o); setFilterOpen(false); }}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--sidebar-bg)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-200"
          >
            <SettingsIcon className="h-4 w-4" />
            Settings
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg">
              {pageSizeOptions.length > 0 && pageSize !== undefined && onPageSizeChange && (
                <div className="border-b border-[var(--border)] px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Rows per page</p>
                  <div className="mt-1 flex gap-1">
                    {pageSizeOptions.map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { onPageSizeChange(n); setSettingsOpen(false); }}
                        className={`rounded px-2 py-1 text-sm ${pageSize === n ? "bg-[var(--accent)] text-white" : "bg-gray-100 text-[var(--text)] hover:bg-gray-200"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showSettingsLink && (
                <Link
                  href="/settings#dashboard-preferences"
                  onClick={() => setSettingsOpen(false)}
                  className="block px-3 py-2 text-sm text-[var(--text)] hover:bg-gray-100"
                >
                  Dashboard preference
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function FilterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
