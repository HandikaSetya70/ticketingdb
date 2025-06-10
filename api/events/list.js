// /api/events/list.js
// Enhanced event listing with pricing and availability

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    // Extract query parameters
    const {
      upcoming,
      past,
      category,
      min_price,
      max_price,
      available_only = 'true',
      sort = 'event_date',
      order = 'asc',
      page = 1,
      limit = 10
    } = req.query;

    // Build query
    let       query = supabase
      .from('events')
      .select(`
        event_id,
        event_name,
        event_date,
        venue,
        event_description,
        event_image_url,
        category,
        ticket_price,
        total_tickets,
        available_tickets
      `);

    // Apply filters
    if (upcoming === 'true') {
      query = query.gte('event_date', new Date().toISOString());
    }

    if (past === 'true') {
      query = query.lt('event_date', new Date().toISOString());
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (min_price) {
      query = query.gte('ticket_price', parseFloat(min_price));
    }

    if (max_price) {
      query = query.lte('ticket_price', parseFloat(max_price));
    }

    if (available_only === 'true') {
      query = query.gt('available_tickets', 0);
    }

    // Apply sorting
    query = query.order(sort, { ascending: order === 'asc' });

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    query = query.range(from, to);

    // Execute query
    const { data: events, error, count } = await query;

    if (error) {
      throw error;
    }

    // Calculate additional fields for each event
    const enhancedEvents = events.map(event => {
      const soldTickets = event.total_tickets - event.available_tickets;
      const soldPercentage = event.total_tickets > 0 
        ? Math.round((soldTickets / event.total_tickets) * 100) 
        : 0;

      let salesStatus = 'available';
      if (event.available_tickets === 0) {
        salesStatus = 'sold_out';
      } else if (event.available_tickets <= event.total_tickets * 0.1) {
        salesStatus = 'limited';
      }

      return {
        id: event.event_id,
        name: event.event_name,
        date: event.event_date,
        venue: event.venue,
        description: event.event_description,
        image: event.event_image_url,
        category: event.category,
        price: parseFloat(event.ticket_price || 0),
        total: event.total_tickets || 0,
        available: event.available_tickets || 0,
        sold: soldTickets,
        sold_percentage: soldPercentage,
        status: salesStatus,
        currency: 'USD',
        is_sold_out: event.available_tickets === 0
      };
    });

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true });

    // Pagination info
    const totalPages = Math.ceil((totalCount || 0) / limitNum);
    const hasMore = pageNum < totalPages;
    const hasPrev = pageNum > 1;

    // Cache headers for mobile optimization
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    res.setHeader('ETag', `"events-${Date.now()}"`);

    return res.status(200).json({
      status: 'success',
      message: 'Events retrieved successfully',
      data: {
        events: enhancedEvents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalCount || 0,
          totalPages,
          hasMore,
          hasPrev
        },
        filters_applied: {
          upcoming: upcoming === 'true',
          past: past === 'true',
          category: category || null,
          price_range: {
            min: min_price ? parseFloat(min_price) : null,
            max: max_price ? parseFloat(max_price) : null
          },
          available_only: available_only === 'true'
        },
        cached_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes from now
      }
    });

  } catch (error) {
    console.error('Error retrieving events:', error);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred while retrieving events',
      error: error.message
    });
  }
}