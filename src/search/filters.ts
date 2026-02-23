export interface MetadataFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
  value: any;
}

export interface FilterGroup {
  operator: 'and' | 'or';
  filters: (MetadataFilter | FilterGroup)[];
}

export class MetadataQueryBuilder {
  buildWhereClause(
    filter: MetadataFilter | FilterGroup | undefined,
    paramOffset: number = 0
  ): { clause: string; params: any[]; paramCount: number } {
    if (!filter) {
      return { clause: '', params: [], paramCount: 0 };
    }

    if ('operator' in filter && 'filters' in filter) {
      return this.buildGroupClause(filter as FilterGroup, paramOffset);
    }

    return this.buildSingleClause(filter as MetadataFilter, paramOffset);
  }

  buildWhereClauseForDocIds(
    filter: MetadataFilter | FilterGroup | undefined,
    docIdCount: number
  ): { clause: string; params: any[]; paramCount: number } {
    return this.buildWhereClause(filter, docIdCount);
  }

  private buildGroupClause(
    group: FilterGroup,
    paramOffset: number
  ): { clause: string; params: any[]; paramCount: number } {
    const clauses: string[] = [];
    const params: any[] = [];
    let currentOffset = paramOffset;

    for (const filter of group.filters) {
      const result = this.buildWhereClause(filter, currentOffset);
      if (result.clause) {
        clauses.push(result.clause);
        params.push(...result.params);
        currentOffset = result.paramCount;
      }
    }

    if (clauses.length === 0) {
      return { clause: '', params: [], paramCount: paramOffset };
    }

    const joinOperator = group.operator === 'and' ? ' AND ' : ' OR ';
    return {
      clause: `(${clauses.join(joinOperator)})`,
      params,
      paramCount: currentOffset,
    };
  }

  private buildSingleClause(
    filter: MetadataFilter,
    paramOffset: number
  ): { clause: string; params: any[]; paramCount: number } {
    const paramIndex = paramOffset + 1;
    const jsonPath = `json_extract(metadata, '$.${filter.field}')`;

    switch (filter.operator) {
      case 'eq':
        return {
          clause: `${jsonPath} = ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'ne':
        return {
          clause: `${jsonPath} != ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'gt':
        return {
          clause: `${jsonPath} > ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'gte':
        return {
          clause: `${jsonPath} >= ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'lt':
        return {
          clause: `${jsonPath} < ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'lte':
        return {
          clause: `${jsonPath} <= ?${paramIndex}`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      case 'in':
        const placeholders = (filter.value as any[])
          .map((_, i) => `?${paramIndex + i}`)
          .join(', ');
        return {
          clause: `${jsonPath} IN (${placeholders})`,
          params: filter.value as any[],
          paramCount: paramIndex + (filter.value as any[]).length - 1,
        };
      case 'contains':
        return {
          clause: `json_array_contains(${jsonPath}, ?${paramIndex})`,
          params: [filter.value],
          paramCount: paramIndex,
        };
      default:
        throw new Error(`Unknown operator: ${filter.operator}`);
    }
  }
}

export const MetadataFilters = {
  collection: (name: string): MetadataFilter => ({
    field: 'collection',
    operator: 'eq',
    value: name,
  }),
  dateRange: (start: Date, end: Date): FilterGroup => ({
    operator: 'and',
    filters: [
      { field: 'date', operator: 'gte', value: start.toISOString() },
      { field: 'date', operator: 'lte', value: end.toISOString() },
    ],
  }),
  fileType: (ext: string): MetadataFilter => ({
    field: 'fileType',
    operator: 'eq',
    value: ext,
  }),
  tag: (tag: string): MetadataFilter => ({
    field: 'tags',
    operator: 'contains',
    value: tag,
  }),
};
