import { biasColors } from './shared.js';

/**
 * Reusable row chart component for Kleptocracy Tracker
 */
export class RowChart {
    constructor(facts, attribute, width, maxItems, updateFunction, title, dim, parentSelector = '#chart-container', showSearch = false, singleSelect = false, showCount = true) {
        this.title = title;
        this.field = attribute;
        this.singleSelect = singleSelect;
        this.dim = dim ? dim : facts.dimension(dc.pluck(attribute));
        this.group = this.dim.group().reduceSum(dc.pluck('count'));

        this.group = removeZeroes(this.group);

        const ROW_HEIGHT = 22;
        const MARGINS = { top: 0, right: 10, bottom: 20, left: 10 };

        const container = d3.select(parentSelector)
            .append('div')
            .attr('id', 'chart-' + attribute);
        
        const titleRow = container.append('div')
            .attr('class', 'chart-title');
        
        titleRow.append('span')
            .attr('class', 'chart-title-text')
            .text(title);
        
        titleRow.append('span')
            .attr('class', 'chart-title-count')
            .attr('id', 'chart-' + attribute + '-count');
        
        const contentId = 'chart-' + attribute + '-content';
        
        // Add autocomplete search if enabled
        if (showSearch) {
            const group = this.group;
            const chartRef = { chart: null };
            
            const searchContainer = container.append('div')
                .attr('class', 'chart-search-container');
            
            const searchInput = searchContainer.append('input')
                .attr('type', 'text')
                .attr('class', 'chart-search')
                .attr('placeholder', 'Find a publication')
                .attr('spellcheck', 'false');
            
            searchContainer.append('span')
                .attr('class', 'chart-search-icon')
                .html('⌕');
            
            const clearBtn = searchContainer.append('button')
                .attr('class', 'chart-search-clear')
                .attr('type', 'button')
                .text('✕');
            
            const dropdown = searchContainer.append('div')
                .attr('class', 'chart-search-dropdown');
            
            let selectedIndex = -1;
            
            const getAllItems = () => {
                return group.top(Infinity).filter(d => d.value > 0);
            };
            
            const renderDropdown = (searchTerm) => {
                if (!searchTerm) {
                    dropdown.style('display', 'none');
                    return;
                }
                
                const items = getAllItems();
                const matches = items
                    .filter(d => d.key.toLowerCase().includes(searchTerm.toLowerCase()))
                    .slice(0, 12);
                
                if (matches.length === 0) {
                    dropdown.style('display', 'none');
                    return;
                }
                
                dropdown.html('');
                matches.forEach((d, i) => {
                    dropdown.append('div')
                        .attr('class', 'chart-search-item' + (i === selectedIndex ? ' selected' : ''))
                        .attr('data-value', d.key)
                        .html(`<span class="item-name">${d.key}</span><span class="item-count">${d.value.toLocaleString()}</span>`);
                });
                
                dropdown.style('display', 'block');
                
                dropdown.selectAll('.chart-search-item').on('mousedown', function(event) {
                    event.preventDefault();
                    const value = d3.select(this).attr('data-value');
                    selectItem(value);
                });
            };
            
            const selectItem = (value) => {
                if (chartRef.chart) {
                    chartRef.chart.filter(value);
                    dc.redrawAll();
                    updateFunction();
                }
                searchInput.property('value', value);
                searchInput.classed('has-selection', true);
                searchContainer.classed('has-selection', true);
                dropdown.style('display', 'none');
                selectedIndex = -1;
            };
            
            searchInput.on('input', function() {
                if (searchInput.classed('has-selection')) {
                    searchInput.classed('has-selection', false);
                    searchContainer.classed('has-selection', false);
                }
                selectedIndex = -1;
                renderDropdown(this.value);
            });
            
            searchInput.on('keydown', function(event) {
                const items = dropdown.selectAll('.chart-search-item');
                const count = items.size();
                
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, count - 1);
                    items.classed('selected', (d, i) => i === selectedIndex);
                } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    items.classed('selected', (d, i) => i === selectedIndex);
                } else if (event.key === 'Enter' && selectedIndex >= 0) {
                    event.preventDefault();
                    const selected = items.filter((d, i) => i === selectedIndex);
                    if (!selected.empty()) {
                        selectItem(selected.attr('data-value'));
                    }
                } else if (event.key === 'Escape') {
                    dropdown.style('display', 'none');
                    selectedIndex = -1;
                }
            });
            
            searchInput.on('blur', function() {
                setTimeout(() => dropdown.style('display', 'none'), 150);
            });
            
            clearBtn.on('click', function() {
                if (searchInput.classed('has-selection') && chartRef.chart) {
                    const currentValue = searchInput.property('value');
                    chartRef.chart.filter(currentValue);
                    dc.redrawAll();
                    updateFunction();
                }
                searchInput.property('value', '');
                searchInput.classed('has-selection', false);
                searchContainer.classed('has-selection', false);
                dropdown.style('display', 'none');
                selectedIndex = -1;
            });
            
            this.setChartRef = (chart) => { chartRef.chart = chart; };
        }
        
        container.append('div')
            .attr('id', contentId)
            .attr('class', 'chart-scroll');

        function generatePublicationColorMap(facts) {
            const map = {};
            facts.all().forEach(r => {
                if (!map[r.publication]) {
                    map[r.publication] = biasColors[r.bias] || '#2b6cb0';
                }
            });
            return map;
        }
        const publicationColorMap = generatePublicationColorMap(facts);

        this.chart = dc.rowChart('#chart-' + attribute + '-content')
            .dimension(this.dim)
            .group(this.group)
            .data(d => d.top(maxItems))
            .width(width)
            .height(Math.max(1, Math.min(maxItems, this.group.all().length)) * ROW_HEIGHT + MARGINS.top + MARGINS.bottom)
            .fixedBarHeight(ROW_HEIGHT)
            .margins(MARGINS)
            .elasticX(true)
            .colors(d => {
                if (attribute === 'publication') return publicationColorMap[d] || '#718096';
                if (attribute === 'bias') return biasColors[d] || '#718096';
                // Light grey for mediaOutletType, country, and other charts
                return '#d8dce0';
            })
            .label(d => `${d.key}  (${d.value.toLocaleString()})`)
            .labelOffsetX(5)
            .on('filtered', () => updateFunction())
            .on('pretransition', chart => {
                chart.selectAll('g.axis').remove();
                chart.selectAll('path.domain').remove();
                chart.selectAll('.grid-line').remove();
                
                const filters = chart.filters();
                
                chart.selectAll('g.row rect').each(function(d) {
                    const rect = d3.select(this);
                    const isSelected = filters.includes(d.key);
                    
                    if (isSelected) {
                        rect.attr('stroke', '#1a365d')
                            .attr('stroke-width', 2);
                    } else {
                        rect.attr('stroke', null)
                            .attr('stroke-width', null);
                    }
                });
            });

        this.chart.xAxis().ticks(0).tickSize(0).tickFormat(() => '');
        
        if (singleSelect) {
            this.chart.filterHandler((dimension, filters) => {
                if (filters.length === 0) {
                    dimension.filter(null);
                } else {
                    dimension.filterExact(filters[filters.length - 1]);
                }
                return filters;
            });
        }

        const adjustHeight = () => {
            const visibleData = this.group.top(maxItems);
            const visible = visibleData.length;        
            this.chart.height(Math.max(1, visible) * (ROW_HEIGHT + 2) + MARGINS.top + MARGINS.bottom);
        };
        this.chart.on('preRender', adjustHeight);
        this.chart.on('preRedraw', adjustHeight);
        
        if (showCount) {
            const countEl = d3.select('#chart-' + attribute + '-count');
            const updateCount = () => {
                const filters = this.chart.filters();
                if (filters && filters.length > 0) {
                    countEl.text(filters.length.toLocaleString());
                } else {
                    const visibleData = this.group.top(maxItems);
                    const count = visibleData.length;
                    countEl.text(count.toLocaleString());
                }
            };
            this.chart.on('postRender', updateCount);
            this.chart.on('postRedraw', updateCount);
        }
        
        if (this.setChartRef) {
            this.setChartRef(this.chart);
        }

        function removeZeroes(group) {
            const keep = d => d.value > 0;
            return {
                all: () => group.all().filter(keep),
                top: n => group.top(Infinity).filter(keep).slice(0, n)
            };
        }
    }
}
