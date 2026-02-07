# History Filters Implementation Plan

## Overview

Add filtering capabilities to the Version History settings page for action type, source, and date range. Convert the existing entity type filter to use consistent chip-based UI.

**Scope:**
- Entity type filter: convert from button group to multi-select chips (consistency)
- Action filter: multi-select chips (create, update, delete, restore, archive, unarchive)
- Source filter: multi-select chips (web, api, mcp-content, mcp-prompt, unknown)
- Date range filter: datetime with presets (All time, Last 7 days, Last 30 days, Custom range)

**API Design for Date Range:**
- Use ISO 8601 datetime format: `start_date=2024-01-15T00:00:00Z` and `end_date=2024-01-20T23:59:59Z`
- Both parameters are optional
- Dates are inclusive
- Backend interprets as UTC

**UI Design:**
- Use chip-based multi-select for all filters (entity type, action, source)
- Empty selection = show all (no filtering)
- Use preset dropdown for date range with custom datetime inputs when "Custom" is selected

**Key Design Decisions:**
- Source validation uses existing `RequestSource` enum from `core/request_context.py`
- Date range queries already have an index: `ix_content_history_user_created` on `(user_id, created_at)`
- Query keys must sort arrays to ensure cache stability regardless of selection order
- Source display: Both `mcp-content` and `mcp-prompt` display as "MCP" (implementation detail)
- Empty selection = show all (differs from ContentTypeFilterChips which requires at least one)
- Date range validation: Return 422 if `start_date > end_date`

**FilterChip Component Design:**
- Create a `FilterChip` primitive component (pure UI, no selection logic)
- Refactor `ContentTypeFilterChips` to use the new primitive
- Use `FilterChip` directly in SettingsVersionHistory with inline toggle logic

---

## Milestone 1: Backend API Filters

### Goal
Add action, source, and date range query parameters to the `/history` endpoint. Convert entity_type from single-value to multi-value for consistency with other filters.

### Success Criteria
- `/history?entity_type=bookmark&entity_type=note` returns bookmarks and notes
- `/history?action=create&action=update` returns only create and update actions
- `/history?source=web&source=mcp-content` returns only web and MCP content sources
- `/history?start_date=2024-01-01T00:00:00Z&end_date=2024-01-31T23:59:59Z` returns records in that range
- Invalid entity_type, action, or source values return 422 validation error
- All filters can be combined
- Tests cover all filter combinations

### Key Changes

1. **Update `/history` endpoint in `backend/src/api/routers/history.py`:**

   Add new query parameters using existing enums for type safety:
   ```python
   from datetime import datetime
   from models.content_history import ActionType, EntityType
   from core.request_context import RequestSource

   @router.get("/", response_model=HistoryListResponse)
   async def get_user_history(
       entity_type: list[EntityType] | None = Query(default=None, description="Filter by entity types"),
       action: list[ActionType] | None = Query(default=None, description="Filter by action types"),
       source: list[RequestSource] | None = Query(default=None, description="Filter by source"),
       start_date: datetime | None = Query(default=None, description="Filter records on or after this datetime (ISO 8601 UTC)"),
       end_date: datetime | None = Query(default=None, description="Filter records on or before this datetime (ISO 8601 UTC)"),
       limit: int = Query(default=50, ge=1, le=100),
       offset: int = Query(default=0, ge=0),
       current_user: User = Depends(get_current_user),
       db: AsyncSession = Depends(get_async_session),
   ) -> HistoryListResponse:
   ```

   Note: Using `list[EntityType]`, `list[ActionType]`, and `list[RequestSource]` gives us automatic 422 validation for invalid values.

2. **Update `history_service.get_user_history()` in `backend/src/services/history_service.py`:**

   Add filter parameters and conditions:
   ```python
   from core.request_context import RequestSource

   async def get_user_history(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_types: list[EntityType | str] | None = None,
       actions: list[ActionType | str] | None = None,
       sources: list[RequestSource | str] | None = None,
       start_date: datetime | None = None,
       end_date: datetime | None = None,
       limit: int = 50,
       offset: int = 0,
   ) -> tuple[list[ContentHistory], int]:
       conditions = [ContentHistory.user_id == user_id]

       if entity_types:
           entity_type_values = [e.value if isinstance(e, EntityType) else e for e in entity_types]
           conditions.append(ContentHistory.entity_type.in_(entity_type_values))

       if actions:
           action_values = [a.value if isinstance(a, ActionType) else a for a in actions]
           conditions.append(ContentHistory.action.in_(action_values))

       if sources:
           source_values = [s.value if isinstance(s, RequestSource) else s for s in sources]
           conditions.append(ContentHistory.source.in_(source_values))

       if start_date:
           conditions.append(ContentHistory.created_at >= start_date)

       if end_date:
           conditions.append(ContentHistory.created_at <= end_date)

       # ... rest of query (count + paginated select)
   ```

   Note: Date range queries use the existing `ix_content_history_user_created` index on `(user_id, created_at)`.

### Testing Strategy

1. **Unit tests for `get_user_history` with filters:**
   - Single entity_type filter returns only matching entity type
   - Multiple entity_type filter returns union (OR logic)
   - Single action filter returns only matching actions
   - Multiple action filter returns union (OR logic)
   - Single source filter returns only matching source
   - Multiple source filter returns union (OR logic)
   - Start date only filters correctly
   - End date only filters correctly
   - Date range (both dates) filters correctly
   - Combined filters (entity_type + action + source + date) work together
   - Empty filter lists return all records (same as None)

2. **API endpoint tests:**
   - Query parameter parsing for list params (`?entity_type=bookmark&entity_type=note`)
   - Query parameter parsing for list params (`?action=create&action=update`)
   - Invalid entity_type returns 422
   - Invalid action type returns 422
   - Invalid source type returns 422
   - Invalid date format returns 422
   - start_date > end_date returns 422
   - Filters combine correctly with pagination

### Dependencies
None (uses existing models and endpoint)

### Risk Factors
- FastAPI list query param handling - verify `list[ActionType]` parses correctly from repeated params (should work per FastAPI docs)

---

## Milestone 2: Frontend Hook Updates

### Goal
Update `useUserHistory` hook to accept new filter parameters with proper cache key handling.

### Success Criteria
- Hook accepts actions, sources, startDate, endDate parameters
- Parameters are correctly passed to API as query params
- Query key includes all filter params with sorted arrays for cache stability
- TypeScript types are correct

### Key Changes

1. **Add/verify types in `frontend/src/types/index.ts`:**

   Ensure source type exists:
   ```typescript
   export type HistorySourceType = 'web' | 'api' | 'mcp-content' | 'mcp-prompt' | 'unknown'
   ```

2. **Update query key factory in `frontend/src/hooks/useHistory.ts`:**

   Sort arrays to ensure cache stability regardless of selection order:
   ```typescript
   export const historyKeys = {
     all: ['history'] as const,
     user: (params: {
       entityTypes?: HistoryEntityType[]
       actions?: HistoryActionType[]
       sources?: HistorySourceType[]
       startDate?: string
       endDate?: string
       limit?: number
       offset?: number
     }) => [...historyKeys.all, 'user', {
       ...params,
       // Sort arrays to ensure consistent cache keys regardless of selection order
       entityTypes: params.entityTypes?.slice().sort(),
       actions: params.actions?.slice().sort(),
       sources: params.sources?.slice().sort(),
     }] as const,
     // ... rest unchanged
   }
   ```

3. **Update `useUserHistory` hook:**

   ```typescript
   export function useUserHistory(params: {
     entityTypes?: HistoryEntityType[]  // Changed from entityType to support multi-select
     actions?: HistoryActionType[]
     sources?: HistorySourceType[]
     startDate?: string  // ISO 8601 datetime (UTC)
     endDate?: string    // ISO 8601 datetime (UTC)
     limit?: number
     offset?: number
   }) {
     return useQuery<HistoryListResponse>({
       queryKey: historyKeys.user(params),
       queryFn: async () => {
         const queryParams = new URLSearchParams()

         // Use append for array params to create repeated query params
         params.entityTypes?.forEach(t => queryParams.append('entity_type', t))
         params.actions?.forEach(a => queryParams.append('action', a))
         params.sources?.forEach(s => queryParams.append('source', s))

         if (params.startDate) queryParams.append('start_date', params.startDate)
         if (params.endDate) queryParams.append('end_date', params.endDate)
         if (params.limit !== undefined) queryParams.append('limit', String(params.limit))
         if (params.offset !== undefined) queryParams.append('offset', String(params.offset))

         const response = await api.get<HistoryListResponse>(`/history?${queryParams}`)
         return response.data
       },
     })
   }
   ```

   Note: Changed `entityType` (single) to `entityTypes` (array) to support chip-based multi-select.

### Testing Strategy

1. **Hook tests:**
   - Verify query params are correctly serialized for list values
   - Verify same logical filters produce same query key regardless of array order
   - Verify empty arrays don't add params
   - Verify query key changes when filters change (cache invalidation)

### Dependencies
Milestone 1 (backend API must support filters)

### Risk Factors
- URLSearchParams handling for repeated params - use `append()`, not `set()`

---

## Milestone 3: Filter UI Components

### Goal
Add filter UI to SettingsVersionHistory page with consistent chip-based filtering for all filter types.

### Success Criteria
- Entity type filter converted from button group to multi-select chips
- Action filter shows all 6 action types as multi-select chips
- Source filter shows all 5 sources as multi-select chips
- Date range shows preset dropdown (All time, Last 7 days, Last 30 days, Custom)
- Custom date range shows datetime inputs
- Empty selection = show all (consistent across all filters)
- Clear visual indication of active filters
- Reset to page 0 when filters change

### Key Changes

1. **Create reusable FilterChips component or inline pattern:**

   Follow the existing `ContentTypeFilterChips` pattern for consistency.

2. **Update `SettingsVersionHistory.tsx`:**

   Add state for all filters (convert entityType to array):
   ```typescript
   // All filters use "empty = show all" pattern
   const [entityTypeFilter, setEntityTypeFilter] = useState<HistoryEntityType[]>([])
   const [actionFilter, setActionFilter] = useState<HistoryActionType[]>([])
   const [sourceFilter, setSourceFilter] = useState<HistorySourceType[]>([])
   const [datePreset, setDatePreset] = useState<DatePreset>('all')
   const [customStartDate, setCustomStartDate] = useState<string>('')
   const [customEndDate, setCustomEndDate] = useState<string>('')
   ```

   Calculate date values with proper UTC conversion:
   ```typescript
   const { startDate, endDate } = useMemo(() => {
     if (datePreset === 'all') {
       return { startDate: undefined, endDate: undefined }
     }
     if (datePreset === 'last7') {
       const end = new Date()
       const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
       return { startDate: start.toISOString(), endDate: end.toISOString() }
     }
     if (datePreset === 'last30') {
       const end = new Date()
       const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)
       return { startDate: start.toISOString(), endDate: end.toISOString() }
     }
     // Custom: datetime-local returns local time, convert to UTC
     return {
       startDate: customStartDate ? new Date(customStartDate).toISOString() : undefined,
       endDate: customEndDate ? new Date(customEndDate).toISOString() : undefined,
     }
   }, [datePreset, customStartDate, customEndDate])
   ```

   Pass to hook (empty arrays = undefined = show all):
   ```typescript
   const { data: history, isLoading, error } = useUserHistory({
     entityTypes: entityTypeFilter.length > 0 ? entityTypeFilter : undefined,
     actions: actionFilter.length > 0 ? actionFilter : undefined,
     sources: sourceFilter.length > 0 ? sourceFilter : undefined,
     startDate,
     endDate,
     limit,
     offset: page * limit,
   })
   ```

3. **Filter UI layout:**

   All filters use consistent chip-based UI:
   ```tsx
   <div className="mb-6 space-y-3">
     {/* Entity type filter - chips */}
     <div className="flex items-center gap-2">
       <span className="text-xs text-gray-500 w-16">Type:</span>
       <div className="flex flex-wrap gap-1.5">
         {ENTITY_TYPES.map(type => (
           <FilterChip
             key={type}
             label={formatEntityType(type)}
             icon={getEntityIcon(type)}
             selected={entityTypeFilter.includes(type)}
             onClick={() => toggleEntityType(type)}
           />
         ))}
       </div>
     </div>

     {/* Action filter - chips */}
     <div className="flex items-center gap-2">
       <span className="text-xs text-gray-500 w-16">Action:</span>
       <div className="flex flex-wrap gap-1.5">
         {ACTION_TYPES.map(action => (
           <FilterChip
             key={action}
             label={formatAction(action)}
             selected={actionFilter.includes(action)}
             onClick={() => toggleAction(action)}
           />
         ))}
       </div>
     </div>

     {/* Source filter - chips */}
     <div className="flex items-center gap-2">
       <span className="text-xs text-gray-500 w-16">Source:</span>
       <div className="flex flex-wrap gap-1.5">
         {SOURCE_TYPES.map(source => (
           <FilterChip
             key={source}
             label={formatSource(source)}
             selected={sourceFilter.includes(source)}
             onClick={() => toggleSource(source)}
           />
         ))}
       </div>
     </div>

     {/* Date range - preset dropdown + optional custom inputs */}
     <div className="flex items-center gap-2">
       <span className="text-xs text-gray-500 w-16">Date:</span>
       <select
         value={datePreset}
         onChange={(e) => setDatePreset(e.target.value as DatePreset)}
         className="text-sm rounded-md border-gray-300 ..."
       >
         <option value="all">All time</option>
         <option value="last7">Last 7 days</option>
         <option value="last30">Last 30 days</option>
         <option value="custom">Custom range</option>
       </select>
       {datePreset === 'custom' && (
         <>
           <input
             type="datetime-local"
             value={customStartDate}
             onChange={(e) => setCustomStartDate(e.target.value)}
             className="text-sm rounded-md border-gray-300 ..."
           />
           <span className="text-gray-400">to</span>
           <input
             type="datetime-local"
             value={customEndDate}
             onChange={(e) => setCustomEndDate(e.target.value)}
             className="text-sm rounded-md border-gray-300 ..."
           />
         </>
       )}
     </div>
   </div>
   ```

4. **Toggle helper functions:**
   ```typescript
   const toggleEntityType = (type: HistoryEntityType) => {
     setEntityTypeFilter(prev =>
       prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
     )
     setPage(0)  // Reset pagination when filter changes
   }
   // Similar for toggleAction, toggleSource
   ```

### Testing Strategy

1. **Component tests:**
   - Clicking chip toggles selection state
   - Multiple chips can be selected
   - Deselecting all chips results in empty array (show all behavior)
   - Changing date preset updates date values correctly
   - Custom date inputs convert local time to UTC
   - Custom date inputs only show when preset is "custom"
   - Filter changes reset page to 0

2. **Integration tests:**
   - Filter changes trigger new API request with correct params
   - Multiple filters combine correctly (AND across categories, OR within)
   - Empty filters return all records

### Dependencies
Milestone 2 (hook must support filter params)

### Risk Factors
- UI may get crowded with many filter chips - consider responsive layout or collapsible sections if needed
- datetime-local browser support is good but verify consistent styling

---

## Summary

| Milestone | Scope | Key Changes |
|-----------|-------|-------------|
| 1 | Backend API filters | Convert entity_type to multi-value, add action, source, date params with enum validation |
| 2 | Frontend hook updates | Update hook params, sort arrays in query keys |
| 3 | Filter UI components | Create FilterChip component, chip-based UI for all filters, date preset dropdown |

Total: 3 milestones, straightforward extension of existing patterns.
