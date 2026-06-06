# Use an official lightweight Node.js runtime
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files first to leverage Docker's caching mechanism
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy the rest of your application code
COPY . .

# Expose the port your Express app listens on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]