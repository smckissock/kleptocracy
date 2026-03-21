/**
 * Kleptocracy Tracker Explorer
 * Interactive dashboard for exploring kleptocracy-related news stories
 */

import { RowChart } from './rowChart.js';
import { formatDate, scrollToTop, biasColors, loadGzippedCsv } from './shared.js';

export class Site {
    constructor() {
        if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') 
            document.title = 'Kleptocracy Tracker DEV';

        this.stories = this.getData();
        window.site = this;        
    }
   
    async getData() {      
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.replace('loading-hidden', 'loading-visible');

        // Determine data path based on environment
        const isLocal = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
        const dataPath = isLocal ? '/data/' : './data/';

        // Load stories, entities, and themes in parallel
        const [allStories, entitiesData, themesData] = await Promise.all([
            d3.csv(dataPath + 'stories.csv'),
            loadGzippedCsv(dataPath + 'entities.csv.gz'),
            d3.csv(dataPath + 'themes.csv')
        ]);
        
        // Store themes for UI
        this.themes = themesData;
        
        const stories = allStories;

        stories.forEach(story => {
            story.count = 1;
            story.date = new Date(story.publishDate);
            if (story.title === '') {
                story.title = 'Link to story';
            }
            // Parse comma-separated authorList into array for crossfilter
            story.authorArray = (story.authorList || '')
                .split(',')
                .map(a => a.trim())
                .filter(Boolean);
            // Parse comma-separated themes into array for crossfilter
            story.themeArray = (story.themes || '')
                .split(',')
                .map(t => t.trim())
                .filter(Boolean);
        });

        this.stories = stories;
        
        // Build entity index for search
        this.buildEntityIndex(entitiesData);

        // Display the latest publish date
        const maxDate = d3.max(stories, d => d.date);
        if (maxDate && !isNaN(maxDate)) {
            const formatted = maxDate.toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric' 
            });
            document.getElementById('updated-date').textContent = `Updated ${formatted}`;
        }

        this.facts = crossfilter(this.stories);
        dc.facts = this.facts;
        
        // Create entity dimension for filtering by selected entity (uses story ID)
        this.entityDimension = this.facts.dimension(d => d.id);
        // Track which story IDs match the current entity filter
        this.entityStoryIds = null;
        
        // Create theme dimension for filtering by themes (array dimension)
        this.themeDimension = this.facts.dimension(d => d.themeArray, true);
        // Track selected theme slugs
        this.selectedThemes = new Set();

        this.setupCharts();
        dc.renderAll();
        this.refresh();
        overlay.classList.replace('loading-visible', 'loading-hidden'); 
    }

    setupCharts() {
        const boundRefresh = () => this.refresh();
        dc.refresh = boundRefresh;
        
        dc.rowCharts = [
            new RowChart(this.facts, 'publication', 170, 10000, boundRefresh, 'Outlet', null, '#chart-publication', true, false, true),
            new RowChart(this.facts, 'bias', 170, 6, boundRefresh, 'Left/Right', null, '#chart-bias', false, false, false),
            new RowChart(this.facts, 'mediaOutletType', 170, 9, boundRefresh, 'Media Type', null, '#chart-mediaOutletType', false, false, false),
            new RowChart(this.facts, 'country', 170, 20, boundRefresh, 'Country', null, '#chart-country', false, false, false),
        ];
        
        // Month chart hidden - uncomment to restore
        // this.setupMonthChart();
        this.setupAuthorChart();
        this.setupThemeFilters();
        this.setupEntitySearch();
        this.listStories();
    }

    /**
     * Build entity index from loaded CSV data
     * Creates lookup structures for typeahead search
     */
    buildEntityIndex(entitiesData) {
        // entityIndex: name -> { type, storyCount, stories: {storyId: score} }
        this.entityIndex = {};
        // entityNames: sorted array for typeahead filtering
        this.entityNames = [];
        
        entitiesData.forEach(row => {
            const storyScores = JSON.parse(row.storyScores || '{}');
            this.entityIndex[row.name] = {
                type: row.entityType,
                storyCount: parseInt(row.storyCount) || 0,
                stories: storyScores
            };
        });
        
        // Sort by story count descending for better typeahead results
        this.entityNames = Object.keys(this.entityIndex)
            .sort((a, b) => this.entityIndex[b].storyCount - this.entityIndex[a].storyCount);
        
        console.log(`Loaded ${this.entityNames.length} entities for search`);
        
        // Populate example links with random entities
        this.populateExampleLinks();
    }
    
    /**
     * Populate example links with random entities that fit without wrapping
     */
    populateExampleLinks() {
        const linksContainer = document.getElementById('example-links');
        const refreshBtn = document.getElementById('refresh-examples');
        if (!linksContainer || this.entityNames.length === 0) return;
        
        const refreshExamples = () => {
            // Clear existing links
            linksContainer.innerHTML = '';
            
            // Pick random entities from top 30 by story count, excluding Anne Applebaum
            const topEntities = this.entityNames
                .filter(n => n !== 'Anne Applebaum')
                .slice(0, Math.min(30, this.entityNames.length));
            const shuffled = [...topEntities].sort(() => Math.random() - 0.5);
            
            // Add links one by one, checking if they fit
            const maxLinks = 12;
            let addedCount = 0;
            
            for (let i = 0; i < shuffled.length && addedCount < maxLinks; i++) {
                const name = shuffled[i];
                const link = document.createElement('a');
                link.href = '#';
                link.className = 'example-link';
                link.dataset.entity = name;
                link.textContent = name;
                linksContainer.appendChild(link);
                
                // Check if container is overflowing (wrapped)
                const container = document.getElementById('search-examples');
                if (container.scrollWidth > container.clientWidth) {
                    // Remove this link - it caused overflow
                    linksContainer.removeChild(link);
                    break;
                }
                
                addedCount++;
            }
            
            // Wire up click handlers for the new links
            linksContainer.querySelectorAll('.example-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const entityName = link.dataset.entity;
                    if (entityName && this.entityIndex[entityName]) {
                        this.selectEntity(entityName);
                    }
                });
            });
        };
        
        // Initial population
        refreshExamples();
        
        // Wire up refresh button
        if (refreshBtn) {
            refreshBtn.addEventListener('click', refreshExamples);
        }
    }

    /**
     * Setup theme filter buttons in the sidebar
     */
    setupThemeFilters() {
        const sidebar = document.getElementById('filter-sidebar');
        if (!sidebar || !this.themes) return;
        
        // Clear existing content
        sidebar.innerHTML = '';

        // Add header
        const header = document.createElement('div');
        header.className = 'chart-title sidebar-header';
        header.textContent = 'TOPICS';
        sidebar.appendChild(header);
        
        // Create theme buttons from loaded themes.csv
        this.themes.forEach(theme => {
            const button = document.createElement('button');
            button.className = 'theme-filter-btn';
            button.dataset.slug = theme.slug;
            
            button.innerHTML = `
                <span class="theme-label">${theme.label}</span>
                <span class="theme-description">${theme.briefDescription}</span>
            `;
            
            button.addEventListener('click', () => {
                this.toggleThemeFilter(theme.slug, button);
            });
            
            sidebar.appendChild(button);
        });
    }
    
    /**
     * Toggle a theme filter on/off
     */
    toggleThemeFilter(slug, button) {
        if (this.selectedThemes.has(slug)) {
            this.selectedThemes.delete(slug);
            button.classList.remove('active');
        } else {
            this.selectedThemes.add(slug);
            button.classList.add('active');
        }
        
        // Apply filter to dimension
        if (this.selectedThemes.size === 0) {
            this.themeDimension.filterAll();
        } else {
            this.themeDimension.filterFunction(d => this.selectedThemes.has(d));
        }
        
        // Redraw all charts and refresh
        dc.redrawAll();
        this.refresh();
    }
    
    /**
     * Clear all theme filters
     */
    clearThemeFilters() {
        this.selectedThemes.clear();
        this.themeDimension.filterAll();
        
        // Update button states
        document.querySelectorAll('.theme-filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        dc.redrawAll();
        this.refresh();
    }

    /**
     * Setup entity search with typeahead dropdown
     */
    setupEntitySearch() {
        const searchInput = document.getElementById('story-search');
        const searchSection = document.getElementById('search-section');
        
        // Create dropdown container
        const dropdown = document.createElement('div');
        dropdown.id = 'entity-dropdown';
        dropdown.className = 'entity-dropdown hidden';
        searchSection.querySelector('#search-input-wrapper').appendChild(dropdown);
        
        // Track selected entity
        this.selectedEntity = null;
        
        // Create selected entity display
        const selectedDisplay = document.createElement('div');
        selectedDisplay.id = 'selected-entity';
        selectedDisplay.className = 'selected-entity hidden';
        searchSection.querySelector('#search-input-wrapper').insertBefore(selectedDisplay, searchInput);
        
        // Input event for typeahead
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                this.hideEntityDropdown();
                return;
            }
            this.showEntityMatches(query);
        });
        
        // Focus/blur handling
        searchInput.addEventListener('focus', () => {
            const query = searchInput.value.trim();
            if (query.length >= 2) {
                this.showEntityMatches(query);
            }
        });
        
        // Click outside to close dropdown
        document.addEventListener('click', (e) => {
            if (!searchSection.contains(e.target)) {
                this.hideEntityDropdown();
            }
        });
        
        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            const dropdown = document.getElementById('entity-dropdown');
            const items = dropdown.querySelectorAll('.entity-item');
            const activeItem = dropdown.querySelector('.entity-item.active');
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!activeItem && items.length > 0) {
                    items[0].classList.add('active');
                } else if (activeItem && activeItem.nextElementSibling) {
                    activeItem.classList.remove('active');
                    activeItem.nextElementSibling.classList.add('active');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeItem && activeItem.previousElementSibling) {
                    activeItem.classList.remove('active');
                    activeItem.previousElementSibling.classList.add('active');
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeItem) {
                    this.selectEntity(activeItem.dataset.entity);
                }
            } else if (e.key === 'Escape') {
                this.hideEntityDropdown();
                searchInput.blur();
            }
        });
        
    }

    /**
     * Filter and show matching entities in dropdown
     */
    showEntityMatches(query) {
        const dropdown = document.getElementById('entity-dropdown');
        const q = query.toLowerCase();
        
        // Filter entities that contain the query
        const matches = this.entityNames
            .filter(name => name.toLowerCase().includes(q))
            .slice(0, 12); // Limit to 12 results
        
        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="entity-no-results">No matching entities</div>';
            dropdown.classList.remove('hidden');
            return;
        }
        
        dropdown.innerHTML = matches.map(name => {
            const entity = this.entityIndex[name];
            const typeIcon = entity.type === 'person' ? '👤' : '📍';
            const storyText = entity.storyCount === 1 ? 'story' : 'stories';
            return `
                <div class="entity-item" data-entity="${name}">
                    <span class="entity-icon">${typeIcon}</span>
                    <span class="entity-name">${this.highlightMatch(name, query)}</span>
                    <span class="entity-count">${entity.storyCount} ${storyText}</span>
                </div>
            `;
        }).join('');
        
        // Add click handlers
        dropdown.querySelectorAll('.entity-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectEntity(item.dataset.entity);
            });
        });
        
        dropdown.classList.remove('hidden');
    }

    /**
     * Highlight matching portion of entity name
     */
    highlightMatch(name, query) {
        const idx = name.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return name;
        return name.slice(0, idx) + 
               '<mark>' + name.slice(idx, idx + query.length) + '</mark>' + 
               name.slice(idx + query.length);
    }

    /**
     * Hide the entity dropdown
     */
    hideEntityDropdown() {
        const dropdown = document.getElementById('entity-dropdown');
        if (dropdown) {
            dropdown.classList.add('hidden');
        }
    }

    /**
     * Select an entity and filter stories
     */
    selectEntity(entityName) {
        const searchInput = document.getElementById('story-search');
        const selectedDisplay = document.getElementById('selected-entity');
        const entity = this.entityIndex[entityName];
        
        if (!entity) return;
        
        this.selectedEntity = entityName;
        this.hideEntityDropdown();
        searchInput.value = '';
        searchInput.classList.add('has-selection');
        
        // Show selected entity chip
        const typeIcon = entity.type === 'person' ? '👤' : '📍';
        selectedDisplay.innerHTML = `
            <span class="entity-chip">
                <span class="entity-icon">${typeIcon}</span>
                <span class="entity-chip-name">${entityName}</span>
                <button class="entity-chip-remove" title="Clear filter">×</button>
            </span>
        `;
        selectedDisplay.classList.remove('hidden');
        
        // Add remove handler
        selectedDisplay.querySelector('.entity-chip-remove').addEventListener('click', () => {
            this.clearEntityFilter();
        });
        
        // Apply entity filter via crossfilter
        this.entityStoryIds = new Set(Object.keys(entity.stories));
        
        // Filter the dimension using filterFunction to check if story ID is in the set
        this.entityDimension.filterFunction(id => this.entityStoryIds.has(String(id)));
        
        // Redraw all charts and refresh
        dc.redrawAll();
        this.refresh();
    }

    /**
     * Clear entity filter
     */
    clearEntityFilter() {
        const searchInput = document.getElementById('story-search');
        const selectedDisplay = document.getElementById('selected-entity');
        
        this.selectedEntity = null;
        this.entityStoryIds = null;
        selectedDisplay.classList.add('hidden');
        searchInput.classList.remove('has-selection');
        
        // Clear the dimension filter
        this.entityDimension.filterAll();
        
        // Redraw all charts and refresh
        dc.redrawAll();
        this.refresh();
    }

    setupMonthChart() {
        function addYearMarkers(chart) {
            const body = chart.select('g.chart-body');
            const x = chart.x();
            const height = chart.effectiveHeight();
            
            body.selectAll('.year-marker').remove();
            body.selectAll('.year-label').remove();
            
            const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027];
            
            years.forEach(year => {
                // Position line at January 1 of each year
                const yearBoundary = new Date(year, 0, 1);
                const xPos = x(yearBoundary);
                
                if (xPos >= 0 && xPos <= chart.effectiveWidth()) {
                    body.append('line')
                        .attr('class', 'year-marker')
                        .attr('x1', xPos)
                        .attr('x2', xPos)
                        .attr('y1', 0)
                        .attr('y2', height)
                        .attr('stroke', '#ccc')
                        .attr('stroke-width', 1)
                        .attr('stroke-dasharray', '3,3')
                        .style('pointer-events', 'none');
                    
                    body.append('text')
                        .attr('class', 'year-label')
                        .attr('x', xPos + 3)
                        .attr('y', 11)
                        .attr('font-size', 11)
                        .attr('font-weight', 500)
                        .attr('fill', '#999')
                        .style('pointer-events', 'none')
                        .text(year);
                }
            });
        }

        // Month floor function
        const monthFloor = d => new Date(d.getFullYear(), d.getMonth(), 1);
        this.monthDimension = this.facts.dimension(d => monthFloor(d.date));
        this.monthGroup = this.monthDimension.group().reduceCount();

        const height = 120;
        const width = 530; 

        // Calculate date range from data (filter out invalid dates)
        const dates = this.stories.map(d => d.date).filter(d => d && !isNaN(d));
        const minDate = d3.min(dates);
        const maxDate = d3.max(dates);
        const minMonth = monthFloor(minDate);
        const maxMonth = d3.timeMonth.offset(monthFloor(maxDate), 1);

        this.monthChart = new dc.BarChart('#chart-month');
        this.monthChart
            .width(width)
            .height(height)
            .dimension(this.monthDimension)
            .group(this.monthGroup)
            .x(d3.scaleTime().domain([minMonth, maxMonth]))
            .xUnits(d3.timeMonths)
            .elasticY(true)
            .centerBar(true)
            .colors(['#6b9fd4'])  // Blue to match row charts
            .barPadding(0.1) 
            .brushOn(true)
            .margins({ top: 10, right: 10, bottom: 20, left: 40 })
            .on('filtered', () => this.refresh())
            .on('postRender', chart => { addYearMarkers(chart); })
            .on('postRedraw', chart => { addYearMarkers(chart); });

        this.monthChart.xAxis().tickFormat(() => '').tickSize(0);
        this.monthChart.yAxis().ticks(3);

        dc.monthDimension = this.monthDimension;
        dc.monthChart = this.monthChart;
    }

    setupAuthorChart() {
        const container = d3.select('#chart-authors');
        container.html('');
        
        const titleRow = container.append('div')
            .attr('class', 'chart-title');
        
        titleRow.append('span')
            .attr('class', 'chart-title-text')
            .text('Author');
        
        titleRow.append('span')
            .attr('class', 'chart-title-count')
            .attr('id', 'chart-authors-count');
        
        const ROW_HEIGHT = 22;
        const MARGINS = { top: 0, right: 10, bottom: 20, left: 10 };
        const maxItems = 10000;
        const width = 170;

        this.authorDimension = this.facts.dimension(d => d.authorArray, true);
        this.authorGroup = this.authorDimension.group().reduceCount();

        const removeZeroes = (group) => {
            const keep = d => d.value > 0 && d.key !== '';
            return {
                all: () => group.all().filter(keep),
                top: n => group.top(Infinity).filter(keep).slice(0, n)
            };
        };
        
        const filteredGroup = removeZeroes(this.authorGroup);
        const self = this;
        
        // Add autocomplete search
        const searchContainer = container.append('div')
            .attr('class', 'chart-search-container');
        
        const searchInput = searchContainer.append('input')
            .attr('type', 'text')
            .attr('class', 'chart-search')
            .attr('placeholder', 'Find an author')
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
        
        const getAllItems = () => filteredGroup.top(Infinity);
        
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
            if (self.authorChart) {
                self.authorChart.filter(value);
                dc.redrawAll();
                self.refresh();
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
            if (searchInput.classed('has-selection') && self.authorChart) {
                const currentValue = searchInput.property('value');
                self.authorChart.filter(currentValue);
                dc.redrawAll();
                self.refresh();
            }
            searchInput.property('value', '');
            searchInput.classed('has-selection', false);
            searchContainer.classed('has-selection', false);
            dropdown.style('display', 'none');
            selectedIndex = -1;
        });
        
        container.append('div')
            .attr('id', 'chart-authors-content')
            .attr('class', 'chart-scroll');

        this.authorChart = dc.rowChart('#chart-authors-content')
            .dimension(this.authorDimension)
            .group(filteredGroup)
            .data(d => d.top(maxItems))
            .width(width)
            .height(maxItems * ROW_HEIGHT + MARGINS.top + MARGINS.bottom)
            .fixedBarHeight(ROW_HEIGHT)
            .margins(MARGINS)
            .elasticX(true)
            .colors(['#d8dce0'])
            .label(d => `${d.key}  (${d.value.toLocaleString()})`)
            .labelOffsetX(5)
            .on('pretransition', chart => {
                chart.selectAll('g.axis').remove();
                chart.selectAll('path.domain').remove();
                chart.selectAll('.grid-line').remove();
                
                const filters = chart.filters();
                chart.selectAll('g.row rect').each(function(d) {
                    const rect = d3.select(this);
                    const isSelected = filters.includes(d.key);
                    if (isSelected) {
                        rect.attr('stroke', '#1a365d').attr('stroke-width', 2);
                    } else {
                        rect.attr('stroke', null).attr('stroke-width', null);
                    }
                });
            })
            .on('filtered', () => this.refresh());

        this.authorChart.xAxis().ticks(0).tickSize(0).tickFormat(() => '');

        const adjustHeight = () => {
            const visibleData = removeZeroes(this.authorGroup).top(maxItems);
            const visible = visibleData.length;
            this.authorChart.height(Math.max(1, visible) * (ROW_HEIGHT + 2) + MARGINS.top + MARGINS.bottom);
        };
        this.authorChart.on('preRender', adjustHeight);
        this.authorChart.on('preRedraw', adjustHeight);
        
        const countEl = d3.select('#chart-authors-count');
        const updateCount = () => {
            const filters = this.authorChart.filters();
            if (filters && filters.length > 0) {
                countEl.text(filters.length.toLocaleString());
            } else {
                const visibleData = removeZeroes(this.authorGroup).top(maxItems);
                const count = visibleData.length;
                countEl.text(count.toLocaleString());
            }
        };
        this.authorChart.on('postRender', updateCount);
        this.authorChart.on('postRedraw', updateCount);

        dc.authorChart = this.authorChart;
        dc.authorDimension = this.authorDimension;
    }

    collectFilters() {
        const filterTypes = [];

        // Row chart filters
        dc.rowCharts.forEach(rc => {
            const chartFilters = rc.chart.filters();
            if (chartFilters.length > 0) {
                filterTypes.push({
                    name: rc.title,
                    filters: chartFilters
                });
            }
        });

        // Month filter
        if (dc.monthDimension) {
            const rng = dc.monthDimension.currentFilter();
            if (rng && rng[0] && rng[1]) {
                const fmt = d3.timeFormat('%b %Y');
                const label = `${fmt(rng[0])} – ${fmt(rng[1])}`;
                filterTypes.push({
                    name: 'Date',
                    filters: [label]
                });
            }
        }

        // Author filter
        if (dc.authorChart) {
            const authorFilters = dc.authorChart.filters() || [];
            if (authorFilters.length > 0) {
                filterTypes.push({
                    name: 'Author',
                    filters: authorFilters
                });
            }
        }

        // Theme filters
        if (this.selectedThemes && this.selectedThemes.size > 0) {
            // Convert slugs to labels for display
            const themeLabels = Array.from(this.selectedThemes).map(slug => {
                const theme = this.themes.find(t => t.slug === slug);
                return theme ? theme.label : slug;
            });
            filterTypes.push({
                name: 'Theme',
                filters: themeLabels
            });
        }

        return filterTypes;
    }

    refresh() {          
        const filterTypes = this.collectFilters();
        const hasActiveFilters = filterTypes.length > 0;
        const filteredStories = dc.facts.allFiltered();
        const storyCount = filteredStories.length;
        const publicationCount = new Set(filteredStories.map(s => s.publication)).size;
        const postCount = new Set(filteredStories.map(s => s.link).filter(Boolean)).size;

        // Render menu info
        let menuHtml = `<span class="story-count">${storyCount.toLocaleString()} citations from ${postCount.toLocaleString()} Kleptocracy Tracker posts</span>`;
        if (hasActiveFilters) {
            menuHtml += `<button class="clear-button">Show All</button>`;
        }
        d3.select('#menu-info').html(menuHtml);

        // Render filter boxes
        if (filterTypes.length > 0) {
            const filterBoxes = filterTypes.map(filterType => {
                const valueBadges = filterType.filters.map(value => `
                    <span class="filter-value-badge" data-filter-name="${filterType.name}" data-filter-value="${value}">
                        ${value} <span class="filter-value-close">✕</span>
                    </span>
                `).join('');
                return `
                    <div class="filter-box">
                        <div class="filter-box-title">${filterType.name}</div>
                        <div class="filter-box-values">${valueBadges}</div>
                    </div>
                `;
            }).join('');
            d3.select('#filters').html(`<div class="filter-boxes-container">${filterBoxes}</div>`);
        } else {
            d3.select('#filters').html('');
        }

        // Helper to clear search input
        const clearSearchInput = (containerSelector) => {
            const container = d3.select(containerSelector);
            const input = container.select('.chart-search');
            if (!input.empty()) {
                input.property('value', '');
                input.classed('has-selection', false);
            }
            const searchContainer = container.select('.chart-search-container');
            if (!searchContainer.empty()) {
                searchContainer.classed('has-selection', false);
            }
        };

        // Filter badge click handlers
        d3.selectAll('.filter-value-badge').on('click', (event) => {
            event.stopPropagation();
            const badge = d3.select(event.currentTarget);
            const filterName = badge.attr('data-filter-name');
            const filterValue = badge.attr('data-filter-value');
            
            if (filterName === 'Date' && dc.monthChart) {
                dc.monthChart.filterAll();
            } else if (filterName === 'Author' && dc.authorChart) {
                dc.authorChart.filter(filterValue);
                clearSearchInput('#chart-authors');
            } else if (filterName === 'Theme') {
                // Find the slug from the label and toggle it off
                const theme = this.themes.find(t => t.label === filterValue);
                if (theme) {
                    const button = document.querySelector(`.theme-filter-btn[data-slug="${theme.slug}"]`);
                    if (button) {
                        this.toggleThemeFilter(theme.slug, button);
                    }
                }
                return; // toggleThemeFilter already calls refresh
            } else {
                const rowChart = dc.rowCharts.find(rc => rc.title === filterName);
                if (rowChart) {
                    rowChart.chart.filter(filterValue);
                    if (filterName === 'Media Outlet') {
                        clearSearchInput('#chart-publication');
                    }
                }
            }
            
            dc.redrawAll();
            this.refresh();
        });

        // Clear all button
        d3.select('.clear-button').on('click', () => {
            dc.filterAll();
            clearSearchInput('#chart-publication');
            clearSearchInput('#chart-authors');
            // Clear theme filters
            this.selectedThemes.clear();
            this.themeDimension.filterAll();
            document.querySelectorAll('.theme-filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            dc.redrawAll();
            this.refresh();
        });

        // CSV download button
        d3.select('#download-csv').on('click', () => {
            const stories = dc.facts.allFiltered();
            this.downloadCsv(stories);
        });

        dc.redrawAll();
        scrollToTop('#chart-publication');
        scrollToTop('#chart-authors');
        scrollToTop('#chart-list');
        this.listStories();
    }

    listStories() {
        let stories = this.facts.allFiltered();
        
        // Sort: by entity relevance if entity selected, otherwise by date
        if (this.selectedEntity && this.entityIndex[this.selectedEntity]) {
            const entityStories = this.entityIndex[this.selectedEntity].stories;
            
            // Sort by entity relevance score (descending), then by date
            stories = [...stories].sort((a, b) => {
                const scoreA = entityStories[String(a.id)] || 0;
                const scoreB = entityStories[String(b.id)] || 0;
                if (scoreB !== scoreA) return scoreB - scoreA;
                return new Date(b.date) - new Date(a.date);
            });
        } else {
            // Sort by date descending
            stories = [...stories].sort((a, b) => new Date(b.date) - new Date(a.date));
        }

        let html;
        if (stories.length === 0) {
            html = `<div style="padding:20px;color:#666;">No stories found for the selected filters.</div>`;
        } else {
            html = stories.map(story => this.renderStoryCard(story)).join('');
        }

        d3.select('#chart-list').html(html);
    }

    renderStoryCard(story) {
        const authorLine = story.authorList 
            ? `<div class="story-authors">by ${story.authorList}</div>` 
            : '';

        // Theme pills - convert slugs to labels
        let themePillsHtml = '';
        if (story.themeArray && story.themeArray.length > 0) {
            const themePills = story.themeArray.map(slug => {
                const theme = this.themes.find(t => t.slug === slug);
                const label = theme ? theme.label : slug;
                return `<span class="story-theme-pill" data-slug="${slug}">${label}</span>`;
            }).join('');
            themePillsHtml = `<div class="story-theme-pills">${themePills}</div>`;
        }

        // Use sentence as quote if available, highlighting the linkTitle portion
        // Sentence links to Applebaum's Substack (story.link), card links to publication (story.url)
        let sentenceHtml = '';
        if (story.sentence) {
            let displaySentence = story.sentence;
            if (story.linkTitle && story.sentence.includes(story.linkTitle)) {
                displaySentence = story.sentence.replace(
                    story.linkTitle, 
                    `<mark class="link-highlight">${story.linkTitle}</mark>`
                );
            }
            const linkUrl = (story.link || story.url) + '?open=false#§kleptocracy-tracker';
            sentenceHtml = `<blockquote class="story-quote" data-link="${linkUrl}" onclick="event.stopPropagation(); window.open('${linkUrl}', '_blank', 'noopener')">${displaySentence}</blockquote>`;
        }

        return `
            <div class="story" onclick="window.open('${story.url}', '_blank', 'noopener')">
                <img
                    class="story-image"
                    src="${story.image}"
                    onload="this.classList.add('loaded')"
                    onerror="this.style.display='none'"
                    height="90"
                    width="120"
                >
                <div class="story-body">
                    ${sentenceHtml}
                    <h3 class="story-title">${story.title}</h3>
                    <div class="story-meta">
                        <span class="story-publication">${story.publication}</span>
                        <span class="story-date">${formatDate(story.date)}</span>
                        ${authorLine}
                    </div>
                    ${themePillsHtml}
                </div>
            </div>
        `;
    }

    downloadCsv(stories) {
        const columns = ['publishDate', 'title', 'url', 'publication', 'authorList', 'country', 'bias', 'mediaOutletType', 'sentence'];
        
        const escapeField = (field) => {
            if (field === null || field === undefined) return '';
            const str = String(field);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const header = columns.join(',');
        const rows = stories.map(story => 
            columns.map(col => escapeField(story[col])).join(',')
        );
        
        const csvContent = [header, ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `kleptocracy-tracker-stories-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

const site = new Site();
