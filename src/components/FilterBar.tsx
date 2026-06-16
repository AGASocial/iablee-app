import React from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { useTranslations } from 'next-intl';

interface FilterOption {
    label: string;
    value: string;
}

interface FilterConfig {
    key: string;
    label: string;
    options: FilterOption[];
}

interface FilterBarProps {
    onSearch: (query: string) => void;
    onFilterChange: (key: string, value: string) => void;
    onClearFilters: () => void;
    filters: FilterConfig[];
    activeFilters: Record<string, string>;
    searchQuery: string;
    placeholder?: string;
    className?: string;
}

export function FilterBar({
    onSearch,
    onFilterChange,
    onClearFilters,
    filters,
    activeFilters,
    searchQuery,
    placeholder,
    className,
}: FilterBarProps) {
    const t = useTranslations();
    const hasActiveFilters = searchQuery.length > 0 || Object.keys(activeFilters).length > 0;

    return (
        <div className={`flex flex-col sm:flex-row gap-4 mb-6 ${className}`}>
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder={placeholder || t('search') || 'Search...'}
                    value={searchQuery}
                    onChange={(e) => onSearch(e.target.value)}
                    className="pl-9 dark:placeholder:text-slate-600"
                />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 overflow-x-auto pb-2 sm:pb-0 hide-scrollbar">
                {filters.map((filter) => (
                    <div key={filter.key} className="min-w-[140px]">
                        <Select
                            value={activeFilters[filter.key] || "all"}
                            onValueChange={(value) => onFilterChange(filter.key, value === "all" ? "" : value)}
                        >
                            <SelectTrigger className="dark:data-[placeholder]:text-slate-600">
                                <SelectValue placeholder={filter.label} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('all') || 'All'} {filter.label}</SelectItem>
                                {filter.options.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ))}

                <div className="flex items-center min-h-[40px]">
                    {hasActiveFilters ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onClearFilters}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                            title={t('clearFilters') || "Clear filters"}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    ) : (
                        /* Invisible placeholder to keep layout stable */
                        <div className="w-10 h-10" />
                    )}
                </div>
            </div>
        </div>
    );
}
